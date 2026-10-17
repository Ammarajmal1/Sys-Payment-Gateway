import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations, seedInitialData } from '../src/db/migrate.js';
import { closeDb } from '../src/db/index.js';
import type { FastifyInstance } from 'fastify';

describe('API Key Authentication & Security', () => {
  let app: FastifyInstance;
  let validTestKey: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await runMigrations();
    const seed = await seedInitialData();
    validTestKey = seed.testApiKey;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('rejects requests with missing Authorization or API key header with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/payment-requests',
    });

    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.body);
    expect(json.error).toBe('Unauthorized');
    expect(json.message).toContain('Missing API key');
  });

  it('rejects requests with an invalid API key with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/payment-requests',
      headers: {
        authorization: 'Bearer sg_test_invalid_00000000000000000000',
      },
    });

    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.body);
    expect(json.error).toBe('Unauthorized');
    expect(json.message).toContain('Invalid API key');
  });

  it('allows access with a valid Bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/payment-requests',
      headers: {
        authorization: `Bearer ${validTestKey}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(Array.isArray(json.items)).toBe(true);
  });

  it('allows access using X-API-Key header', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/payment-requests',
      headers: {
        'x-api-key': validTestKey,
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects a revoked API key', async () => {
    // 1. Create a new key
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: { authorization: `Bearer ${validTestKey}` },
      payload: { label: 'Temporary Key to Revoke', environment: 'test' },
    });
    expect(createRes.statusCode).toBe(201);
    const { id: keyId, secret_key: tempKey } = JSON.parse(createRes.body);

    // 2. Verify temporary key works
    const testRes1 = await app.inject({
      method: 'GET',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${tempKey}` },
    });
    expect(testRes1.statusCode).toBe(200);

    // 3. Revoke the key
    const revokeRes = await app.inject({
      method: 'POST',
      url: `/v1/api-keys/${keyId}/revoke`,
      headers: { authorization: `Bearer ${validTestKey}` },
    });
    expect(revokeRes.statusCode).toBe(200);

    // 4. Verify revoked key is now rejected with 401
    const testRes2 = await app.inject({
      method: 'GET',
      url: '/v1/payment-requests',
      headers: { authorization: `Bearer ${tempKey}` },
    });
    expect(testRes2.statusCode).toBe(401);
    expect(JSON.parse(testRes2.body).message).toContain('revoked');
  });
});
