import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations, seedInitialData } from '../src/db/migrate.js';
import { closeDb } from '../src/db/index.js';
import type { FastifyInstance } from 'fastify';

describe('Admin & Merchant Authentication System', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.GATEWAY_ADMIN_USER = 'admin';
    process.env.GATEWAY_ADMIN_PASSWORD = 'TestPassword123!';
    process.env.GATEWAY_JWT_SECRET = 'test_jwt_secret_key_sysgalaxy_32chars!';

    await runMigrations();
    await seedInitialData();
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('1. Rejects login attempt with missing username or password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: '' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Bad Request');
  });

  it('2. Rejects login with wrong credentials (timing-safe check)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        username: 'admin',
        password: 'wrong_password_attempt',
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.message).toContain('Invalid username or password');
  });

  it('3. Successfully logs in with valid credentials and returns signed session token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        username: 'admin',
        password: 'TestPassword123!',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.token.split('.').length).toBe(3); // JWT format
    expect(body.user.username).toBe('admin');
    expect(body.user.role).toBe('admin');
    expect(body.tenant.id).toBeDefined();
  });

  it('4. GET /v1/auth/me verifies session token and returns user profile', async () => {
    // Login to get token
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        username: 'admin',
        password: 'TestPassword123!',
      },
    });
    const { token } = JSON.parse(loginRes.body);

    // Call /v1/auth/me
    const meRes = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(meRes.statusCode).toBe(200);
    const meData = JSON.parse(meRes.body);
    expect(meData.authenticated).toBe(true);
    expect(meData.user.username).toBe('admin');
    expect(meData.tenant.id).toBeDefined();
  });

  it('5. Rejects tampered / forged session token', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImhhY2tlciJ9.invalid_signature_here';
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${fakeToken}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('6. Authorizes protected API routes (e.g. /v1/payments) using session token', async () => {
    // Login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        username: 'admin',
        password: 'TestPassword123!',
      },
    });
    const { token } = JSON.parse(loginRes.body);

    // Access protected payments list with session token
    const paymentsRes = await app.inject({
      method: 'GET',
      url: '/v1/payments',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(paymentsRes.statusCode).toBe(200);
    const data = JSON.parse(paymentsRes.body);
    expect(Array.isArray(data.items)).toBe(true);
  });

  it('7. POST /v1/auth/logout succeeds cleanly', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);
  });
});
