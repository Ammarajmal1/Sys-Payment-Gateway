import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations, seedInitialData } from '../src/db/migrate.js';
import { closeDb } from '../src/db/index.js';
import { TailorOsBillingService } from '../examples/tailor-os/tailor-os-client.js';
import { generateWebhookSignature } from '../src/utils/crypto.js';
import type { FastifyInstance } from 'fastify';

describe('Tailor OS Full End-to-End Integration Journey', () => {
  let app: FastifyInstance;
  let gatewayApiKey: string;
  let tailorBilling: TailorOsBillingService;
  const webhookSecret = 'whsec_tailor_os_test_secret_key_8899aabb';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await runMigrations();
    const seed = await seedInitialData();
    gatewayApiKey = seed.testApiKey;

    app = buildApp();
    await app.ready();

    tailorBilling = new TailorOsBillingService({
      gatewayApiUrl: 'http://localhost:3000',
      gatewayApiKey,
      webhookSecret,
    });
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('executes the complete Tailor OS journey from creation to manual review and subscription activation', async () => {
    const orderRef = `TAILOR-SUB-${Date.now()}`;
    const amountPaisa = 450000; // PKR 4,500.00

    // -------------------------------------------------------------------------
    // Step 1: Tailor OS creates payment request via gateway API
    // -------------------------------------------------------------------------
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: {
        authorization: `Bearer ${gatewayApiKey}`,
        'idempotency-key': `idem_${orderRef}`,
      },
      payload: {
        order_reference: orderRef,
        amount_paisa: amountPaisa,
        payment_method_code: 'jazzcash',
        customer_email: 'ahmad.tailor@example.com',
        customer_name: 'Ahmad Fine Tailors',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const prData = JSON.parse(createRes.body);

    expect(prData.id).toBeDefined();
    expect(prData.status).toBe('awaiting_payment');
    expect(prData.instructions.account_title).toBe('Tailor OS Payments');
    expect(prData.instructions.account_identifier).toBe('03000000000');
    expect(prData.instructions.amount_formatted).toBe('PKR 4,500.00');

    // Simulate Tailor OS internal record creation
    tailorBilling['subscriptions'].set(orderRef, {
      id: 'sub_test_1',
      orderReference: orderRef,
      customerEmail: 'ahmad.tailor@example.com',
      planName: 'Tailor OS Annual Plan',
      amountPaisa,
      currency: 'PKR',
      status: 'pending_payment',
      gatewayPaymentRequestId: prData.id,
    });

    // -------------------------------------------------------------------------
    // Step 2: Customer uploads receipt screenshot
    // -------------------------------------------------------------------------
    const boundary = '----WebKitFormBoundaryTailorE2E';
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x44, 0x41, 0x54, 0x41]);
    const formBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="jazzcash_receipt.png"\r\nContent-Type: image/png\r\n\r\n`),
      fakePng,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await app.inject({
      method: 'POST',
      url: `/v1/payment-requests/${prData.id}/receipt`,
      headers: {
        authorization: `Bearer ${gatewayApiKey}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'x-test-ocr-text': `
          JazzCash Transaction Successful
          TID: 030099881122
          Amount: Rs. 4500.00
          To: 03000000000
        `,
      },
      payload: formBody,
    });

    expect(uploadRes.statusCode).toBe(200);
    const uploadData = JSON.parse(uploadRes.body);

    // Gateway correctly transitions to pending_review
    expect(uploadData.status).toBe('pending_review');

    // -------------------------------------------------------------------------
    // Step 3: Gateway sends signed webhook 'payment.pending_review' to Tailor OS
    // -------------------------------------------------------------------------
    const pendingWebhookPayload = JSON.stringify({
      id: 'evt_pending_review_001',
      eventType: 'payment.pending_review',
      createdAt: new Date().toISOString(),
      paymentRequestId: prData.id,
      orderReference: orderRef,
      amountPaisa,
      currency: 'PKR',
      status: 'pending_review',
      verificationMethod: null,
      data: {},
    });

    const pendingSig = generateWebhookSignature(pendingWebhookPayload, webhookSecret);
    const pendingResult = await tailorBilling.handleGatewayWebhook(
      pendingSig.headerValue,
      pendingWebhookPayload
    );

    // CRITICAL ASSERTION: Tailor OS MUST NOT activate while in pending_review!
    expect(pendingResult.handled).toBe(true);
    expect(pendingResult.actionTaken).toBe('awaiting_merchant_approval');
    expect(tailorBilling.getSubscription(orderRef)?.status).toBe('pending_payment');

    // -------------------------------------------------------------------------
    // Step 4: Merchant reviewer inspects receipt and manually approves payment
    // -------------------------------------------------------------------------
    const approveRes = await app.inject({
      method: 'POST',
      url: `/v1/payments/${uploadData.payment_id}/review/approve`,
      headers: { authorization: `Bearer ${gatewayApiKey}` },
      payload: {
        evidence_reference: 'JazzCash Merchant Statement TID #030099881122',
        notes: 'Confirmed credit in JazzCash business portal for PKR 4,500.',
        reviewer_name: 'Fatima Noor (Accounts Officer)',
      },
    });

    expect(approveRes.statusCode).toBe(200);
    const approveData = JSON.parse(approveRes.body);
    expect(approveData.status).toBe('verified');
    expect(approveData.verification_method).toBe('manual_verified');

    // -------------------------------------------------------------------------
    // Step 5: Gateway dispatches signed webhook 'payment.verified' to Tailor OS
    // -------------------------------------------------------------------------
    const verifiedWebhookPayload = JSON.stringify({
      id: 'evt_verified_002',
      eventType: 'payment.verified',
      createdAt: new Date().toISOString(),
      paymentRequestId: prData.id,
      orderReference: orderRef,
      amountPaisa,
      currency: 'PKR',
      status: 'verified',
      verificationMethod: 'manual_verified',
      data: { reviewed_by: 'Fatima Noor (Accounts Officer)' },
    });

    const verifiedSig = generateWebhookSignature(verifiedWebhookPayload, webhookSecret);
    const verifiedResult = await tailorBilling.handleGatewayWebhook(
      verifiedSig.headerValue,
      verifiedWebhookPayload
    );

    // Tailor OS successfully verifies signature and activates subscription!
    expect(verifiedResult.handled).toBe(true);
    expect(verifiedResult.actionTaken).toBe('subscription_activated');
    expect(tailorBilling.getSubscription(orderRef)?.status).toBe('active');
    expect(tailorBilling.getSubscription(orderRef)?.activatedAt).toBeDefined();

    // -------------------------------------------------------------------------
    // Step 6: Test replay / duplicate webhook idempotency
    // -------------------------------------------------------------------------
    const duplicateResult = await tailorBilling.handleGatewayWebhook(
      verifiedSig.headerValue,
      verifiedWebhookPayload
    );
    expect(duplicateResult.handled).toBe(true);
    expect(duplicateResult.actionTaken).toBe('duplicate_ignored');
    expect(tailorBilling.getSubscription(orderRef)?.status).toBe('active');
  });
});
