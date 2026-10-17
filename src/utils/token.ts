import crypto from 'node:crypto';

export interface SessionTokenPayload {
  userId: string;
  username: string;
  role: string;
  tenantId: string;
  exp: number; // Unix timestamp ms
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Sign an RFC7519 HMAC-SHA256 JWT session token
 */
export function signSessionToken(payload: SessionTokenPayload, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const data = `${headerEncoded}.${payloadEncoded}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

/**
 * Verify and decode an RFC7519 HMAC-SHA256 session token
 */
export function verifySessionToken(token: string, secret: string): SessionTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerEncoded, payloadEncoded, signature] = parts;
    const data = `${headerEncoded}.${payloadEncoded}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payload: SessionTokenPayload = JSON.parse(base64UrlDecode(payloadEncoded));
    if (payload.exp && Date.now() > payload.exp) {
      return null; // Token expired
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');

  if (bufA.length !== bufB.length) {
    // Perform a dummy timingSafeEqual on hashes of equal length so execution time does not leak
    const hashA = crypto.createHash('sha256').update(bufA).digest();
    const hashB = crypto.createHash('sha256').update(bufB).digest();
    crypto.timingSafeEqual(hashA, hashB);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}
