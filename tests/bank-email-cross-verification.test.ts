import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations, seedInitialData } from '../src/db/migrate.js';
import { closeDb } from '../src/db/index.js';
import type { FastifyInstance } from 'fastify';

function createMockPngBuffer(marker = 'RECEIPT'): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const markerBuffer = Buffer.from(`DATA_${marker}_${Date.now()}_${Math.random()}`);
  return Buffer.concat([header, markerBuffer]);
}

describe('OCR Screenshot + Inbound Bank Email Cross-Verification Workflow', () => {
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

  it('Workflow A: Customer uploads screenshot first (pending_review) -> Bank email arrives -> Auto-verified!', async () => {
    // 1. Merchant / TPMS creates payment request for Order #ORDER-EMAIL-FLOW-1 (PKR 3,500)
    const prRes = await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        order_reference: 'ORDER-EMAIL-FLOW-1',
        amount_paisa: 350000,
        currency: 'PKR',
        payment_method_code: 'bank_transfer',
      },
    });
    const pr = JSON.parse(prRes.body);
    expect(prRes.statusCode).toBe(201);

    // 2. Customer transfers and uploads screenshot
    const boundary = '----WebKitFormBoundaryCrossVerifA';
    const formBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="meezan_slip.png"\r\nContent-Type: image/png\r\n\r\n`),
      createMockPngBuffer('FLOW_A'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const receiptRes = await app.inject({
      method: 'POST',
      url: `/v1/payment-requests/${pr.id}/receipt`,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'x-test-ocr-text': 'Meezan Bank Raast Transfer\nRef No: 7788990011\nAmount: PKR 3,500.00\nDate: 17/10/2026',
      },
      payload: formBody,
    });
    const receiptData = JSON.parse(receiptRes.body);

    // Because bank email has not arrived yet, it is pending_review
    expect(receiptData.status).toBe('pending_review');
    expect(receiptData.ocr.extracted_transaction_id).toBe('7788990011');
    expect(receiptData.ocr.extracted_amount_paisa).toBe(350000);

    // 3. Bank alert email arrives (e.g. via SendGrid / Postmark / IMAP feed)
    const emailRes = await app.inject({
      method: 'POST',
      url: '/v1/bank-feeds/inbound-email',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        raw_email_text: 'Dear Customer, PKR 3,500.00 credited to Account 0102030405. Ref: 7788990011. Transferred from Ali. Meezan Bank',
      },
    });
    const emailData = JSON.parse(emailRes.body);

    expect(emailRes.statusCode).toBe(201);
    expect(emailData.auto_verified).toBe(true);
    expect(emailData.transaction_id).toBe('7788990011');
    expect(emailData.amount_paisa).toBe(350000);
    expect(emailData.matched_order_reference).toBe('ORDER-EMAIL-FLOW-1');

    // 4. Verify payment status is now verified with provider_verified
    const checkRes = await app.inject({
      method: 'GET',
      url: `/v1/payment-requests/${pr.id}`,
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const checkData = JSON.parse(checkRes.body);
    expect(checkData.status).toBe('verified');
    expect(checkData.verification_method).toBe('provider_verified');
  });

  it('Workflow B: Bank email arrives FIRST -> Customer uploads screenshot -> Instant auto-verification!', async () => {
    // 1. Bank alert email arrives first (before customer uploads slip)
    const emailRes = await app.inject({
      method: 'POST',
      url: '/v1/bank-feeds/inbound-email',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        transaction_id: 'JAZZ-9944332211',
        amount_paisa: 120000,
        currency: 'PKR',
        provider: 'jazzcash',
      },
    });
    expect(emailRes.statusCode).toBe(201);
    expect(JSON.parse(emailRes.body).auto_verified).toBe(false); // No pending payment yet

    // 2. TPMS creates payment request for PKR 1,200
    const prRes = await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        order_reference: 'ORDER-EMAIL-FLOW-2',
        amount_paisa: 120000,
        currency: 'PKR',
        payment_method_code: 'jazzcash',
      },
    });
    const pr = JSON.parse(prRes.body);

    // 3. Customer uploads screenshot
    const boundary = '----WebKitFormBoundaryCrossVerifB';
    const formBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="jazzcash_slip.png"\r\nContent-Type: image/png\r\n\r\n`),
      createMockPngBuffer('FLOW_B'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const receiptRes = await app.inject({
      method: 'POST',
      url: `/v1/payment-requests/${pr.id}/receipt`,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'x-test-ocr-text': 'JazzCash TID: JAZZ-9944332211 Amount: Rs. 1200.00 Transferred Successfully',
      },
      payload: formBody,
    });
    const receiptData = JSON.parse(receiptRes.body);

    // Pre-existing bank email matched immediately!
    expect(receiptRes.statusCode).toBe(200);
    expect(receiptData.status).toBe('verified');
    expect(receiptData.verification_method).toBe('provider_verified');
    expect(receiptData.ocr.extracted_transaction_id).toBe('JAZZ-9944332211');
  });

  it('Workflow C: Security Whitelist: Rejects and ignores emails from untrusted senders', async () => {
    // 1. Attacker sends email from a personal/fake address attempting to verify a transaction
    const spoofRes = await app.inject({
      method: 'POST',
      url: '/v1/bank-feeds/inbound-email',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        sender_email: 'attacker123@gmail.com',
        transaction_id: 'FAKE-99887766',
        amount_paisa: 500000,
        currency: 'PKR',
        raw_email_text: 'Dear Customer, PKR 5,000 credited to Account. Ref: FAKE-99887766. Meezan Bank',
      },
    });

    const spoofData = JSON.parse(spoofRes.body);
    expect(spoofData.success).toBe(false);
    expect(spoofData.ignored).toBe(true);
    expect(spoofData.reason).toBe('UNTRUSTED_SENDER');
    expect(spoofData.message).toContain('attacker123@gmail.com');

    // 2. Official bank sender email is accepted
    const genuineRes = await app.inject({
      method: 'POST',
      url: '/v1/bank-feeds/inbound-email',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        sender_email: 'alerts@meezanbank.com',
        transaction_id: 'GENUINE-112233',
        amount_paisa: 500000,
        currency: 'PKR',
        raw_email_text: 'Dear Customer, PKR 5,000 credited to Account. Ref: GENUINE-112233. Meezan Bank',
      },
    });

    const genuineData = JSON.parse(genuineRes.body);
    expect(genuineRes.statusCode).toBe(201);
    expect(genuineData.success).toBe(true);
    expect(genuineData.transaction_id).toBe('GENUINE-112233');
  });

  it('Workflow D: Google Cloud Pub/Sub Webhook: Acknowledges push notification without requiring tenant Bearer token', async () => {
    const rawData = JSON.stringify({
      emailAddress: 'testbankuser@example.com',
      historyId: '987654321',
    });
    const base64Data = Buffer.from(rawData).toString('base64');

    const webhookRes = await app.inject({
      method: 'POST',
      url: '/v1/bank-feeds/gmail/pubsub-webhook?sync=false',
      payload: {
        message: {
          data: base64Data,
          messageId: 'msg-pubsub-12345',
          publishTime: new Date().toISOString(),
        },
        subscription: 'projects/demo/subscriptions/gmail-sub',
      },
    });

    expect(webhookRes.statusCode).toBe(200);
    const body = JSON.parse(webhookRes.body);
    expect(body.success).toBe(true);
    expect(body.history_id).toBe('987654321');
    expect(body.message).toContain('processed');
  });

  it('Workflow E: Google Cloud Pub/Sub Webhook: Enforces secret token when GMAIL_PUBSUB_SECRET is set', async () => {
    process.env.GMAIL_PUBSUB_SECRET = 'secret_test_token_456';

    try {
      // 1. Missing token -> 403 Forbidden
      const unauthRes = await app.inject({
        method: 'POST',
        url: '/v1/bank-feeds/gmail/pubsub-webhook?sync=false',
        payload: {
          message: {
            data: Buffer.from(JSON.stringify({ historyId: '123' })).toString('base64'),
          },
        },
      });
      expect(unauthRes.statusCode).toBe(403);

      // 2. Valid token via query param -> 200 OK
      const validQueryRes = await app.inject({
        method: 'POST',
        url: '/v1/bank-feeds/gmail/pubsub-webhook?token=secret_test_token_456&sync=false',
        payload: {
          message: {
            data: Buffer.from(JSON.stringify({ historyId: '123' })).toString('base64'),
          },
        },
      });
      expect(validQueryRes.statusCode).toBe(200);
      expect(JSON.parse(validQueryRes.body).success).toBe(true);

      // 3. Valid token via header -> 200 OK
      const validHeaderRes = await app.inject({
        method: 'POST',
        url: '/v1/bank-feeds/gmail/pubsub-webhook?sync=false',
        headers: {
          'x-pubsub-token': 'secret_test_token_456',
        },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify({ historyId: '123' })).toString('base64'),
          },
        },
      });
      expect(validHeaderRes.statusCode).toBe(200);
      expect(JSON.parse(validHeaderRes.body).success).toBe(true);
    } finally {
      delete process.env.GMAIL_PUBSUB_SECRET;
    }
  });
});

