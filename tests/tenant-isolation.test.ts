import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations, seedInitialData } from '../src/db/migrate.js';
import { getDb, closeDb } from '../src/db/index.js';
import { sql } from 'drizzle-orm';
import { generateApiKey } from '../src/utils/crypto.js';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';

describe('Multi-Tenant Isolation', () => {
  let app: FastifyInstance;
  let tenant1Key: string;
  let tenant2Key: string;
  let tenant1Id: string;
  let tenant2Id: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await runMigrations();
    const seed = await seedInitialData();
    tenant1Key = seed.testApiKey;
    tenant1Id = seed.tenantId;

    // Create Tenant 2
    const db = await getDb();
    tenant2Id = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO tenants (id, name, slug, status)
      VALUES (${tenant2Id}, 'Merchant Beta Corp', 'merchant-beta-corp', 'active')
    `);

    const { rawKey, keyPrefix, keyHash } = generateApiKey('test');
    tenant2Key = rawKey;

    await db.execute(sql`
      INSERT INTO api_keys (tenant_id, key_hash, key_prefix, label, environment, scopes)
      VALUES (${tenant2Id}, ${keyHash}, ${keyPrefix}, 'Tenant 2 Test Key', 'test', '["*"]'::jsonb)
    `);

    // Add JazzCash method for Tenant 2
    await db.execute(sql`
      INSERT INTO payment_methods (tenant_id, code, name, account_title, account_identifier, instructions, is_active)
      VALUES (${tenant2Id}, 'jazzcash', 'Merchant Beta JazzCash', 'Merchant Beta Title', '03112233445', 'Instructions for beta', TRUE)
    `);

    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('ensures Tenant 2 cannot see or access Tenant 1 payment requests', async () => {
    // 1. Tenant 1 creates a payment request
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${tenant1Key}` },
      payload: {
        order_reference: 'tenant1_secret_order_999',
        amount_paisa: 500000,
        payment_method_code: 'jazzcash',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const tenant1Request = JSON.parse(createRes.body);

    // 2. Tenant 2 lists payment requests -> must NOT contain Tenant 1's request
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${tenant2Key}` },
    });
    expect(listRes.statusCode).toBe(200);
    const listData = JSON.parse(listRes.body);
    const hasTenant1Order = listData.items.some(
      (item: any) => item.order_reference === 'tenant1_secret_order_999'
    );
    expect(hasTenant1Order).toBe(false);

    // 3. Tenant 2 tries to GET Tenant 1's request by ID -> must return 404
    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/payment-requests/${tenant1Request.id}`,
      headers: { authorization: `Bearer ${tenant2Key}` },
    });
    expect(getRes.statusCode).toBe(404);
    expect(JSON.parse(getRes.body).message).toContain('not found');
  });

  it('ensures Tenant 2 cannot see Tenant 1 API keys', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/api-keys',
      headers: { authorization: `Bearer ${tenant2Key}` },
    });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);

    // All returned keys must belong strictly to Tenant 2
    for (const key of json.items) {
      expect(key.key_prefix).not.toContain('sg_test_7f9a2e'); // Tenant 1 key prefix
    }
  });
});
