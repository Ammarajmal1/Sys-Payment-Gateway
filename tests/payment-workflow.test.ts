import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations, seedInitialData } from '../src/db/migrate.js';
import { closeDb } from '../src/db/index.js';
import type { FastifyInstance } from 'fastify';

describe('Payment Request Creation & Workflow', () => {
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

  it('creates a payment request with integer paisa amount and returns instructions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        order_reference: 'ORDER_PAISA_101',
        amount_paisa: 125000, // PKR 1,250.00
        payment_method_code: 'easypaisa',
        customer_name: 'Zeeshan Ali',
        customer_phone: '03451122334',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toBeDefined();
    expect(body.reference).toMatch(/^pr_test_/);
    expect(body.order_reference).toBe('ORDER_PAISA_101');
    expect(body.amount_paisa).toBe(125000);
    expect(body.currency).toBe('PKR');
    expect(body.status).toBe('awaiting_payment');
    expect(body.verification_method).toBeNull();
    expect(body.instructions).toBeDefined();
    expect(body.instructions.payment_method_code).toBe('easypaisa');
    expect(body.instructions.account_title).toBe('Tailor OS Payments');
    expect(body.instructions.account_identifier).toBe('03450000000');
    expect(body.instructions.amount_formatted).toBe('PKR 1,250.00');
  });

  it('creates a payment request using rupees amount and converts to paisa', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        order_reference: 'ORDER_RUPEES_102',
        amount: 2500.50, // PKR 2,500.50 -> 250050 paisa
        payment_method_code: 'jazzcash',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.amount_paisa).toBe(250050);
  });

  it('honors Idempotency-Key and returns cached response', async () => {
    const idempotencyKey = `idem_key_${Date.now()}_abc`;

    // First call
    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'idempotency-key': idempotencyKey,
      },
      payload: {
        order_reference: 'ORDER_IDEM_200',
        amount_paisa: 300000,
        payment_method_code: 'bank_transfer',
      },
    });

    expect(res1.statusCode).toBe(201);
    const body1 = JSON.parse(res1.body);

    // Second call with same idempotency key
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'idempotency-key': idempotencyKey,
      },
      payload: {
        order_reference: 'ORDER_IDEM_200',
        amount_paisa: 300000,
        payment_method_code: 'bank_transfer',
      },
    });

    expect(res2.statusCode).toBe(201);
    expect(res2.headers['x-cache-lookup']).toBe('IDEMPOTENT_HIT');
    const body2 = JSON.parse(res2.body);
    expect(body2.id).toBe(body1.id);
    expect(body2.reference).toBe(body1.reference);
  });

  it('cancels an active payment request', async () => {
    // 1. Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        order_reference: 'ORDER_TO_CANCEL_300',
        amount_paisa: 100000,
        payment_method_code: 'jazzcash',
      },
    });
    const pr = JSON.parse(createRes.body);

    // 2. Cancel
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/v1/payment-requests/${pr.id}/cancel`,
      headers: { authorization: `Bearer ${apiKey}` },
    });

    expect(cancelRes.statusCode).toBe(200);
    const cancelBody = JSON.parse(cancelRes.body);
    expect(cancelBody.status).toBe('cancelled');

    // 3. Verify get returns cancelled
    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/payment-requests/${pr.id}`,
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(JSON.parse(getRes.body).status).toBe('cancelled');
  });

  it('rejects an invalid payment method code', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        order_reference: 'ORDER_BAD_METHOD',
        amount_paisa: 100000,
        payment_method_code: 'bitcoin_unsupported',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toContain('not configured');
  });
});
