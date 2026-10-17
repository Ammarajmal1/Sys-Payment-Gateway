import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations, seedInitialData } from '../src/db/migrate.js';
import { closeDb } from '../src/db/index.js';
import type { FastifyInstance } from 'fastify';

// Helper to construct a synthetic multipart PNG image buffer
function createMockPngBuffer(marker = 'TEST_RECEIPT'): Buffer {
  // Valid PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const markerBuffer = Buffer.from(`DATA_${marker}_${Date.now()}_${Math.random()}`);
  return Buffer.concat([header, markerBuffer]);
}

describe('Deterministic Verification Engine & Security', () => {
  let app: FastifyInstance;
  let apiKey: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await runMigrations();
    const seed = await seedInitialData();
    apiKey = seed.testApiKey;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('CRITICAL: Never marks payment verified solely on OCR extraction; falls back to pending_review', async () => {
    // 1. Create a payment request for PKR 1,500.00 (150000 paisa)
    const prRes = await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        order_reference: 'ORDER_VERIF_1',
        amount_paisa: 150000,
        payment_method_code: 'easypaisa',
      },
    });
    const pr = JSON.parse(prRes.body);

    // 2. Prepare receipt image with OCR text containing exact matching amount and TID
    const pngBuffer = createMockPngBuffer('REC_1');
    const ocrText = `
      Easypaisa Transaction Successful
      TRX ID: 034598127341
      Amount: Rs. 1500.00
      To: Tailor OS Payments (03450000000)
      Date: 16/10/2026 14:35:00
    `;

    // 3. Upload receipt using multipart boundary
    const boundary = '----WebKitFormBoundarySysGalaxyTest';
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="easypaisa_slip.png"\r\nContent-Type: image/png\r\n\r\n`),
      pngBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/v1/payment-requests/${pr.id}/receipt`,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'x-test-ocr-text': ocrText,
      },
      payload,
    });

    expect(uploadRes.statusCode).toBe(200);
    const result = JSON.parse(uploadRes.body);

    // CRITICAL ASSERTION:
    // Even though OCR extracted the exact expected amount, status MUST be 'pending_review'
    // and verification_method MUST be null (NOT 'provider_verified').
    expect(result.status).toBe('pending_review');
    expect(result.verification_method).toBeNull();
    expect(result.ocr.extracted_amount_paisa).toBe(150000);
    expect(result.ocr.extracted_transaction_id).toBe('034598127341');

    // Check verification checks breakdown
    const checkNames = result.checks.map((c: any) => c.checkName);
    expect(checkNames).toContain('AMOUNT_MATCH');
    expect(checkNames).toContain('TRUSTED_PROVIDER_EVIDENCE');

    const trustedCheck = result.checks.find((c: any) => c.checkName === 'TRUSTED_PROVIDER_EVIDENCE');
    expect(trustedCheck.passed).toBe(false);
  });

  it('rejects a duplicate receipt with the exact same SHA-256 hash', async () => {
    // 1. Create Request A and Request B
    const prA = JSON.parse((await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { order_reference: 'ORDER_DUP_A', amount_paisa: 100000, payment_method_code: 'jazzcash' },
    })).body);

    const prB = JSON.parse((await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { order_reference: 'ORDER_DUP_B', amount_paisa: 100000, payment_method_code: 'jazzcash' },
    })).body);

    // 2. Exact same image buffer
    const staticPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    ]);

    const boundary = '----WebKitFormBoundarySysGalaxyDup';
    const formBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slip.png"\r\nContent-Type: image/png\r\n\r\n`),
      staticPng,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    // 3. Upload for Request A -> accepted to pending_review
    const resA = await app.inject({
      method: 'POST',
      url: `/v1/payment-requests/${prA.id}/receipt`,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'x-test-ocr-text': 'JazzCash TID: 9911223344 Amount: Rs. 1000',
      },
      payload: formBody,
    });
    expect(resA.statusCode).toBe(200);

    // 4. Upload identical file for Request B -> rejected
    const resB = await app.inject({
      method: 'POST',
      url: `/v1/payment-requests/${prB.id}/receipt`,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'x-test-ocr-text': 'JazzCash TID: 9911223344 Amount: Rs. 1000',
      },
      payload: formBody,
    });

    expect(resB.statusCode).toBe(200);
    const resultB = JSON.parse(resB.body);
    expect(resultB.status).toBe('rejected');
    expect(resultB.rejection_reason).toContain('Duplicate receipt detected');
  });

  it('allows manual review approval with required evidence reference and audit trail', async () => {
    // 1. Create payment request and upload receipt
    const pr = JSON.parse((await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { order_reference: 'ORDER_MANUAL_APP', amount_paisa: 500000, payment_method_code: 'bank_transfer' },
    })).body);

    const boundary = '----WebKitFormBoundaryManualApp';
    const formBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bank_slip.png"\r\nContent-Type: image/png\r\n\r\n`),
      createMockPngBuffer('MANUAL_APP_REC'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/v1/payment-requests/${pr.id}/receipt`,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'x-test-ocr-text': 'Meezan Bank Transfer Ref: FT26289001 Amount: Rs. 5000.00',
      },
      payload: formBody,
    });
    const uploadData = JSON.parse(uploadRes.body);
    expect(uploadData.status).toBe('pending_review');

    // 2. Authorized reviewer manually approves the payment
    const approveRes = await app.inject({
      method: 'POST',
      url: `/v1/payments/${uploadData.payment_id}/review/approve`,
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        evidence_reference: 'Meezan Corporate NetBanking Entry #998811',
        notes: 'Verified credit in merchant bank statement at 15:40 PKR 5,000.',
        reviewer_name: 'Zahra Khan (Finance Lead)',
      },
    });

    expect(approveRes.statusCode).toBe(200);
    const approveData = JSON.parse(approveRes.body);
    expect(approveData.status).toBe('verified');
    expect(approveData.verification_method).toBe('manual_verified');
    expect(approveData.reviewed_by).toBe('Zahra Khan (Finance Lead)');

    // 3. Verify payment record updated
    const getPaymentRes = await app.inject({
      method: 'GET',
      url: `/v1/payments/${uploadData.payment_id}`,
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const payment = JSON.parse(getPaymentRes.body);
    expect(payment.status).toBe('verified');
    expect(payment.verification_method).toBe('manual_verified');
    expect(payment.manual_review_notes).toContain('Meezan Corporate NetBanking Entry #998811');
  });

  it('allows manual review rejection with required reason', async () => {
    // 1. Create payment request
    const pr = JSON.parse((await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { order_reference: 'ORDER_MANUAL_REJ', amount_paisa: 200000, payment_method_code: 'easypaisa' },
    })).body);

    const boundary = '----WebKitFormBoundaryManualRej';
    const formBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fake_slip.png"\r\nContent-Type: image/png\r\n\r\n`),
      createMockPngBuffer('MANUAL_REJ_REC'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/v1/payment-requests/${pr.id}/receipt`,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'x-test-ocr-text': 'Easypaisa Amount Rs. 2000',
      },
      payload: formBody,
    });
    const uploadData = JSON.parse(uploadRes.body);

    // 2. Reject payment
    const rejectRes = await app.inject({
      method: 'POST',
      url: `/v1/payments/${uploadData.payment_id}/review/reject`,
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        reason: 'Payment slip is tampered. Transaction not found in merchant account statement.',
        reviewer_name: 'Zahra Khan (Finance Lead)',
      },
    });

    expect(rejectRes.statusCode).toBe(200);
    const rejectData = JSON.parse(rejectRes.body);
    expect(rejectData.status).toBe('rejected');
    expect(rejectData.rejection_reason).toContain('tampered');
  });
});
