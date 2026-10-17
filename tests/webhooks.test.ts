import { describe, it, expect } from 'vitest';
import { generateWebhookSignature, verifyWebhookSignature } from '../src/utils/crypto.js';

describe('Webhook HMAC-SHA256 Signatures & Replay Protection', () => {
  const secret = 'whsec_99a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4';
  const samplePayload = JSON.stringify({
    id: 'evt_12345',
    eventType: 'payment.verified',
    amountPaisa: 125000,
    currency: 'PKR',
    status: 'verified',
    verificationMethod: 'manual_verified',
  });

  it('generates a valid signature header and successfully verifies it', () => {
    const { headerValue } = generateWebhookSignature(samplePayload, secret);
    expect(headerValue).toMatch(/^t=[0-9]+,v1=[a-f0-9]{64}$/);

    const verification = verifyWebhookSignature(headerValue, samplePayload, secret);
    expect(verification.isValid).toBe(true);
    expect(verification.error).toBeUndefined();
  });

  it('rejects a tampered payload with invalid signature error', () => {
    const { headerValue } = generateWebhookSignature(samplePayload, secret);
    const tamperedPayload = samplePayload.replace('125000', '999999');

    const verification = verifyWebhookSignature(headerValue, tamperedPayload, secret);
    expect(verification.isValid).toBe(false);
    expect(verification.error).toBe('Signature mismatch');
  });

  it('rejects verification if wrong secret is used', () => {
    const { headerValue } = generateWebhookSignature(samplePayload, secret);
    const wrongSecret = 'whsec_different_secret_key_00000000000';

    const verification = verifyWebhookSignature(headerValue, samplePayload, wrongSecret);
    expect(verification.isValid).toBe(false);
    expect(verification.error).toBe('Signature mismatch');
  });

  it('rejects replayed webhook when timestamp exceeds tolerance window (replay attack protection)', () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago (> 300s tolerance)
    const { headerValue } = generateWebhookSignature(samplePayload, secret, oldTimestamp);

    const verification = verifyWebhookSignature(headerValue, samplePayload, secret, 300);
    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain('Signature timestamp out of range');
  });
});
