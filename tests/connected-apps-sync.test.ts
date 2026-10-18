import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations, seedInitialData } from '../src/db/migrate.js';
import { closeDb } from '../src/db/index.js';
import type { FastifyInstance } from 'fastify';

describe('Connected SaaS Applications & Automated Bank Sync', () => {
  let app: FastifyInstance;
  let testApiKey: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await runMigrations();
    const seed = await seedInitialData();
    testApiKey = seed.testApiKey;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('1. Lists seeded connected SaaS applications (TPMS)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/connected-apps',
      headers: {
        authorization: `Bearer ${testApiKey}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(Array.isArray(json.items)).toBe(true);
    expect(json.items.length).toBeGreaterThanOrEqual(1);

    const tpmsApp = json.items.find((a: any) => a.app_code === 'tpms');
    expect(tpmsApp).toBeDefined();
    expect(tpmsApp.name).toContain('TPMS');
  });

  it('2. Registers a new connected SaaS application', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/connected-apps',
      headers: {
        authorization: `Bearer ${testApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Custom ERPNext Store',
        app_code: 'erpnext',
        base_url: 'http://localhost:8000',
        sync_endpoint: '/api/method/erpnext.accounts.get_bank_accounts',
        description: 'Secondary connected ERP store',
      }),
    });

    expect(res.statusCode).toBe(201);
    const json = JSON.parse(res.body);
    expect(json.app_code).toBe('erpnext');
    expect(json.name).toBe('Custom ERPNext Store');
  });

  it('3. Auto-syncs bank receiving accounts from TPMS connected app', async () => {
    // Get TPMS app id
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/connected-apps',
      headers: { authorization: `Bearer ${testApiKey}` },
    });
    const tpmsApp = JSON.parse(listRes.body).items.find((a: any) => a.app_code === 'tpms');
    expect(tpmsApp).toBeDefined();

    // Trigger sync
    const syncRes = await app.inject({
      method: 'POST',
      url: `/v1/connected-apps/${tpmsApp.id}/sync`,
      headers: { authorization: `Bearer ${testApiKey}` },
    });

    expect(syncRes.statusCode).toBe(200);
    const syncJson = JSON.parse(syncRes.body);
    expect(syncJson.success).toBe(true);
    expect(syncJson.synced_count).toBeGreaterThanOrEqual(4);
    expect(syncJson.app_code).toBe('tpms');

    // Verify synced payment methods exist in payment_methods table
    const pmRes = await app.inject({
      method: 'GET',
      url: '/v1/payment-methods?app=tpms',
      headers: { authorization: `Bearer ${testApiKey}` },
    });

    expect(pmRes.statusCode).toBe(200);
    const pmJson = JSON.parse(pmRes.body);
    expect(pmJson.items.length).toBeGreaterThanOrEqual(4);

    const jazzCash = pmJson.items.find((m: any) => m.code === 'tpms_jazzcash');
    expect(jazzCash).toBeDefined();
    expect(jazzCash.account_title).toBe('Muhammad Ammar');
    expect(jazzCash.account_identifier).toBe('03236339102');
    expect(jazzCash.source_app_code).toBe('tpms');

    const bankHabib = pmJson.items.find((m: any) => m.code === 'tpms_bank_al_habib');
    expect(bankHabib).toBeDefined();
    expect(bankHabib.account_identifier).toBe('1002-0081-019283-01-9');
  });

  it('4. Syncs all connected apps with /v1/connected-apps/sync-all', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/connected-apps/sync-all',
      headers: { authorization: `Bearer ${testApiKey}` },
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.success).toBe(true);
    expect(json.total_apps).toBeGreaterThanOrEqual(1);
  });

  it('5. Disconnects an app and cleans up its synced payment methods', async () => {
    // Get erpnext app id
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/connected-apps',
      headers: { authorization: `Bearer ${testApiKey}` },
    });
    const erpApp = JSON.parse(listRes.body).items.find((a: any) => a.app_code === 'erpnext');
    expect(erpApp).toBeDefined();

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/v1/connected-apps/${erpApp.id}`,
      headers: { authorization: `Bearer ${testApiKey}` },
    });

    expect(delRes.statusCode).toBe(200);
    const delJson = JSON.parse(delRes.body);
    expect(delJson.success).toBe(true);

    // Verify it is removed from list
    const checkRes = await app.inject({
      method: 'GET',
      url: '/v1/connected-apps',
      headers: { authorization: `Bearer ${testApiKey}` },
    });
    const checkJson = JSON.parse(checkRes.body);
    expect(checkJson.items.find((a: any) => a.app_code === 'erpnext')).toBeUndefined();
  });
});
