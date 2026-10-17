import { getDb } from './index.js';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';

export async function runMigrations(): Promise<void> {
  const db = await getDb();

  const migrationSql = `
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tenant_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'reviewer',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_tenant_user_email UNIQUE (tenant_id, email)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      label TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'test',
      scopes JSONB NOT NULL DEFAULT '["*"]'::jsonb,
      is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
      revoked_at TIMESTAMPTZ,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      account_title TEXT NOT NULL,
      account_identifier TEXT NOT NULL,
      bank_name TEXT,
      instructions TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      min_amount_paisa BIGINT NOT NULL DEFAULT 100,
      max_amount_paisa BIGINT NOT NULL DEFAULT 100000000,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_tenant_payment_method UNIQUE (tenant_id, code)
    );

    CREATE TABLE IF NOT EXISTS payment_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      request_reference TEXT NOT NULL UNIQUE,
      order_reference TEXT NOT NULL,
      amount_paisa BIGINT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'PKR',
      payment_method_code TEXT NOT NULL,
      customer_reference TEXT,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      status TEXT NOT NULL DEFAULT 'awaiting_payment',
      verification_method TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      cancelled_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      sha256_hash TEXT NOT NULL,
      upload_ip TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ocr_extractions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      raw_text TEXT NOT NULL,
      confidence_score REAL NOT NULL DEFAULT 0,
      detected_provider TEXT,
      extracted_amount_paisa BIGINT,
      extracted_currency TEXT,
      extracted_transaction_id TEXT,
      extracted_date_time TEXT,
      extracted_sender_name TEXT,
      extracted_sender_account TEXT,
      extracted_receiver_name TEXT,
      extracted_receiver_account TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      extraction_notes JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_request_id UUID NOT NULL UNIQUE REFERENCES payment_requests(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
      ocr_extraction_id UUID REFERENCES ocr_extractions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'awaiting_payment',
      verification_method TEXT,
      amount_paisa BIGINT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'PKR',
      transaction_reference TEXT,
      payer_identifier TEXT,
      verified_at TIMESTAMPTZ,
      rejected_at TIMESTAMPTZ,
      rejection_reason TEXT,
      manual_review_notes TEXT,
      manual_reviewed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trusted_payment_evidence (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider_code TEXT NOT NULL,
      provider_transaction_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      amount_paisa BIGINT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'PKR',
      raw_payload JSONB DEFAULT '{}'::jsonb,
      verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_mock BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS verification_checks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      check_name TEXT NOT NULL,
      passed BOOLEAN NOT NULL,
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      events JSONB NOT NULL DEFAULT '["*"]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      webhook_event_id UUID NOT NULL REFERENCES webhook_events(id) ON DELETE CASCADE,
      webhook_endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      http_status_code INTEGER,
      request_headers JSONB DEFAULT '{}'::jsonb,
      request_body TEXT NOT NULL,
      response_body TEXT,
      error_message TEXT,
      next_retry_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS idempotency_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      request_method TEXT NOT NULL,
      request_path TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_headers JSONB DEFAULT '{}'::jsonb,
      response_body TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_tenant_idempotency UNIQUE (tenant_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trusted_bank_senders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      sender_email TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      provider_code TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_trusted_sender UNIQUE (tenant_id, sender_email)
    );

    -- Performance & Isolation Indexes
    CREATE INDEX IF NOT EXISTS idx_payment_requests_tenant ON payment_requests(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_payment_requests_order_ref ON payment_requests(tenant_id, order_reference);
    CREATE INDEX IF NOT EXISTS idx_receipts_hash ON receipts(sha256_hash);
    CREATE INDEX IF NOT EXISTS idx_payments_tenant_txn ON payments(tenant_id, transaction_reference);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_trusted_senders_tenant ON trusted_bank_senders(tenant_id);
  `;

  // Split and execute each statement sequentially for cross-driver compatibility
  const statements = migrationSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export async function seedInitialData(): Promise<{
  tenantId: string;
  testApiKey: string;
  liveApiKey: string;
}> {
  const db = await getDb();

  // Create default Tailor OS demo tenant
  const tenantSlug = 'tailor-os-demo';
  const existingTenantResult = await db.execute(
    sql`SELECT id FROM tenants WHERE slug = ${tenantSlug} LIMIT 1`
  );

  let tenantId: string;

  if (existingTenantResult.rows.length > 0) {
    tenantId = existingTenantResult.rows[0].id as string;
  } else {
    const insertTenant = await db.execute(
      sql`INSERT INTO tenants (name, slug, status)
          VALUES ('Tailor OS Merchant', ${tenantSlug}, 'active')
          RETURNING id`
    );
    tenantId = insertTenant.rows[0].id as string;
  }

  // Generate deterministic test and live keys for demo/local testing
  const testKeyRaw = 'sg_test_7f9a2e8c1b4d3f5a6b7c8d9e0f1a2b3c';
  const liveKeyRaw = 'sg_live_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';

  const testKeyHash = hashApiKey(testKeyRaw);
  const liveKeyHash = hashApiKey(liveKeyRaw);

  // Upsert test API key
  await db.execute(sql`
    INSERT INTO api_keys (tenant_id, key_hash, key_prefix, label, environment, scopes)
    VALUES (${tenantId}, ${testKeyHash}, 'sg_test_7f9a2e', 'Default Test API Key', 'test', '["*"]'::jsonb)
    ON CONFLICT (key_hash) DO NOTHING
  `);

  // Upsert live API key
  await db.execute(sql`
    INSERT INTO api_keys (tenant_id, key_hash, key_prefix, label, environment, scopes)
    VALUES (${tenantId}, ${liveKeyHash}, 'sg_live_1a2b3c', 'Default Production API Key', 'live', '["*"]'::jsonb)
    ON CONFLICT (key_hash) DO NOTHING
  `);

  // Upsert initial payment methods for Easypaisa, JazzCash, Bank Transfer as individual commands
  await db.execute(sql`
    INSERT INTO payment_methods (tenant_id, code, name, account_title, account_identifier, instructions, is_active, min_amount_paisa, max_amount_paisa)
    VALUES
      (${tenantId}, 'easypaisa', 'Easypaisa Mobile Wallet', 'Tailor OS Payments', '03450000000',
       'Send the exact amount via Easypaisa app or USSD *786#. Use the gateway reference as the transfer note.',
       TRUE, 100, 50000000)
    ON CONFLICT (tenant_id, code) DO UPDATE SET
      account_title = EXCLUDED.account_title,
      account_identifier = EXCLUDED.account_identifier,
      instructions = EXCLUDED.instructions;
  `);

  await db.execute(sql`
    INSERT INTO payment_methods (tenant_id, code, name, account_title, account_identifier, instructions, is_active, min_amount_paisa, max_amount_paisa)
    VALUES
      (${tenantId}, 'jazzcash', 'JazzCash Account', 'Tailor OS Payments', '03000000000',
       'Transfer via JazzCash mobile app to account 03000000000. Keep the transaction SMS and screenshot.',
       TRUE, 100, 50000000)
    ON CONFLICT (tenant_id, code) DO UPDATE SET
      account_title = EXCLUDED.account_title,
      account_identifier = EXCLUDED.account_identifier,
      instructions = EXCLUDED.instructions;
  `);

  await db.execute(sql`
    INSERT INTO payment_methods (tenant_id, code, name, account_title, account_identifier, bank_name, instructions, is_active, min_amount_paisa, max_amount_paisa)
    VALUES
      (${tenantId}, 'bank_transfer', 'Direct Bank Transfer (1Link)', 'SysGalaxy Solutions (Pvt) Ltd', 'PK36MEZN0001000123456789', 'Meezan Bank Ltd',
       'Transfer the exact amount using online banking or ATM transfer to the provided IBAN. Upload the transaction receipt screenshot.',
       TRUE, 50000, 500000000)
    ON CONFLICT (tenant_id, code) DO UPDATE SET
      account_title = EXCLUDED.account_title,
      account_identifier = EXCLUDED.account_identifier,
      bank_name = EXCLUDED.bank_name,
      instructions = EXCLUDED.instructions;
  `);

  // Seed default trusted bank senders (Meezan, HBL, Easypaisa, JazzCash)
  await db.execute(sql`
    INSERT INTO trusted_bank_senders (tenant_id, sender_email, sender_name, provider_code, is_active)
    VALUES
      (${tenantId}, 'alerts@meezanbank.com', 'Meezan Bank Credit Alerts', 'meezan_bank', TRUE),
      (${tenantId}, 'noreply@hbl.com', 'HBL Digital Transaction Alerts', 'hbl', TRUE),
      (${tenantId}, 'notifications@easypaisa.com.pk', 'Easypaisa Payment Alerts', 'easypaisa', TRUE),
      (${tenantId}, 'no-reply@jazzcash.com.pk', 'JazzCash Transaction Notifications', 'jazzcash', TRUE)
    ON CONFLICT (tenant_id, sender_email) DO NOTHING;
  `);

  return {
    tenantId,
    testApiKey: testKeyRaw,
    liveApiKey: liveKeyRaw,
  };
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  console.log('Running database migrations...');
  runMigrations()
    .then(() => seedInitialData())
    .then((res) => {
      console.log('Migrations completed successfully!');
      console.log('Seeded Tenant ID:', res.tenantId);
      console.log('Test API Key:', res.testApiKey);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
