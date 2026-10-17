import crypto from 'node:crypto';

/**
 * Generate a new secure API Key with environment prefix
 * e.g. sg_test_32byteHex or sg_live_32byteHex
 */
export function generateApiKey(environment: 'test' | 'live' = 'test'): {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
} {
  const randomBytes = crypto.randomBytes(24).toString('hex');
  const rawKey = `sg_${environment}_${randomBytes}`;
  const keyPrefix = rawKey.substring(0, 14); // e.g. "sg_test_1a2b3c"
  const keyHash = hashApiKey(rawKey);

  return { rawKey, keyPrefix, keyHash };
}

/**
 * Hash raw API key for storage and constant-time lookup
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Compute SHA-256 hex digest of a Buffer (used for receipt deduplication)
 */
export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Sign webhook payload with HMAC-SHA256
 * Returns format: t=<timestamp>,v1=<hex_signature>
 */
export function generateWebhookSignature(payload: string, secret: string, timestamp?: number): {
  timestamp: number;
  signature: string;
  headerValue: string;
} {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signaturePayload = `${ts}.${payload}`;
  const hmac = crypto.createHmac('sha256', secret).update(signaturePayload).digest('hex');
  const headerValue = `t=${ts},v1=${hmac}`;

  return {
    timestamp: ts,
    signature: hmac,
    headerValue,
  };
}

/**
 * Verify webhook signature with replay protection (tolerance in seconds)
 */
export function verifyWebhookSignature(
  headerValue: string,
  rawPayload: string,
  secret: string,
  toleranceSeconds = 300 // 5 minutes tolerance
): { isValid: boolean; error?: string } {
  if (!headerValue) {
    return { isValid: false, error: 'Missing signature header' };
  }

  const parts = headerValue.split(',');
  let timestamp: number | null = null;
  let receivedSignature: string | null = null;

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') {
      timestamp = parseInt(value, 10);
    } else if (key === 'v1') {
      receivedSignature = value;
    }
  }

  if (!timestamp || !receivedSignature) {
    return { isValid: false, error: 'Malformed signature header format' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { isValid: false, error: `Signature timestamp out of range (drift: ${Math.abs(now - timestamp)}s > ${toleranceSeconds}s)` };
  }

  const expectedPayload = `${timestamp}.${rawPayload}`;
  const expectedSignature = crypto.createHmac('sha256', secret).update(expectedPayload).digest('hex');

  // Constant-time comparison to prevent timing attacks
  const expectedBuf = Buffer.from(expectedSignature, 'hex');
  const receivedBuf = Buffer.from(receivedSignature, 'hex');

  if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    return { isValid: false, error: 'Signature mismatch' };
  }

  return { isValid: true };
}
