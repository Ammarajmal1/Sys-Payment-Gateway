import { pgTable, text, integer, bigint, boolean, timestamp, uuid, jsonb, real, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// -----------------------------------------------------------------------------
// 1. Tenants (Merchants/Businesses)
// -----------------------------------------------------------------------------
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// -----------------------------------------------------------------------------
// 2. Tenant Users (Dashboard Admins & Reviewers)
// -----------------------------------------------------------------------------
export const tenantUsers = pgTable('tenant_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['admin', 'reviewer', 'viewer'] }).notNull().default('reviewer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('tenant_user_email_idx').on(table.tenantId, table.email),
]);

// -----------------------------------------------------------------------------
// 3. API Keys (Live & Test keys per tenant)
// -----------------------------------------------------------------------------
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(), // e.g. "sg_test_abc123"
  label: text('label').notNull(),
  environment: text('environment', { enum: ['test', 'live'] }).notNull().default('test'),
  scopes: jsonb('scopes').$type<string[]>().notNull().default(['*']),
  isRevoked: boolean('is_revoked').notNull().default(false),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('api_keys_tenant_id_idx').on(table.tenantId),
  index('api_keys_prefix_idx').on(table.keyPrefix),
]);

// -----------------------------------------------------------------------------
// 3b. Connected SaaS Applications (Multi-App Manager)
// -----------------------------------------------------------------------------
export const connectedApps = pgTable('connected_apps', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  appCode: text('app_code').notNull(),
  baseUrl: text('base_url').notNull(),
  syncEndpoint: text('sync_endpoint').notNull().default('/api/super-admin/receiving-accounts'),
  apiKey: text('api_key'),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  syncedMethodsCount: integer('synced_methods_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('connected_apps_tenant_code_idx').on(table.tenantId, table.appCode),
]);

// -----------------------------------------------------------------------------
// 4. Payment Methods (Configured per tenant: Easypaisa, JazzCash, Bank)
// -----------------------------------------------------------------------------
export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  code: text('code').notNull(), // 'easypaisa' | 'jazzcash' | 'bank_transfer' | custom
  name: text('name').notNull(), // e.g. "JazzCash Mobile Account"
  accountTitle: text('account_title').notNull(),
  accountIdentifier: text('account_identifier').notNull(), // masked or mobile or IBAN
  bankName: text('bank_name'), // optional bank name
  instructions: text('instructions').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  minAmountPaisa: bigint('min_amount_paisa', { mode: 'number' }).notNull().default(100),
  maxAmountPaisa: bigint('max_amount_paisa', { mode: 'number' }).notNull().default(100000000),
  sourceAppCode: text('source_app_code').notNull().default('direct'),
  sourceAppId: uuid('source_app_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('payment_methods_tenant_code_idx').on(table.tenantId, table.code),
]);

// -----------------------------------------------------------------------------
// 5. Payment Requests
// -----------------------------------------------------------------------------
export const paymentRequestStatuses = [
  'awaiting_payment',
  'processing',
  'pending_review',
  'verified',
  'rejected',
  'expired',
  'cancelled',
] as const;

export const verificationMethods = [
  'provider_verified',
  'manual_verified',
] as const;

export const paymentRequests = pgTable('payment_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  requestReference: text('request_reference').notNull().unique(), // e.g. "pr_live_..."
  orderReference: text('order_reference').notNull(), // merchant's internal order/subscription ID
  amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(), // integer paisa (e.g. 125000 = PKR 1,250.00)
  currency: text('currency').notNull().default('PKR'),
  paymentMethodCode: text('payment_method_code').notNull(),
  customerReference: text('customer_reference'),
  customerName: text('customer_name'),
  customerEmail: text('customer_email'),
  customerPhone: text('customer_phone'),
  status: text('status', { enum: paymentRequestStatuses }).notNull().default('awaiting_payment'),
  verificationMethod: text('verification_method', { enum: verificationMethods }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('payment_requests_tenant_idx').on(table.tenantId),
  index('payment_requests_order_ref_idx').on(table.tenantId, table.orderReference),
  index('payment_requests_status_idx').on(table.status),
]);

// -----------------------------------------------------------------------------
// 6. Receipts (Uploaded customer proof/screenshots)
// -----------------------------------------------------------------------------
export const receipts = pgTable('receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentRequestId: uuid('payment_request_id').notNull().references(() => paymentRequests.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  originalFilename: text('original_filename').notNull(),
  storagePath: text('storage_path').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSizeBytes: integer('file_size_bytes').notNull(),
  sha256Hash: text('sha256_hash').notNull(),
  uploadIp: text('upload_ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('receipts_payment_request_idx').on(table.paymentRequestId),
  index('receipts_hash_idx').on(table.sha256Hash),
]);

// -----------------------------------------------------------------------------
// 7. OCR Extractions (Tesseract.js untrusted outputs)
// -----------------------------------------------------------------------------
export const ocrExtractions = pgTable('ocr_extractions', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptId: uuid('receipt_id').notNull().references(() => receipts.id, { onDelete: 'cascade' }),
  paymentRequestId: uuid('payment_request_id').notNull().references(() => paymentRequests.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  rawText: text('raw_text').notNull(),
  confidenceScore: real('confidence_score').notNull().default(0),
  detectedProvider: text('detected_provider'),
  extractedAmountPaisa: bigint('extracted_amount_paisa', { mode: 'number' }),
  extractedCurrency: text('extracted_currency'),
  extractedTransactionId: text('extracted_transaction_id'),
  extractedDateTime: text('extracted_date_time'),
  extractedSenderName: text('extracted_sender_name'),
  extractedSenderAccount: text('extracted_sender_account'),
  extractedReceiverName: text('extracted_receiver_name'),
  extractedReceiverAccount: text('extracted_receiver_account'),
  status: text('status', { enum: ['completed', 'failed', 'low_confidence'] }).notNull().default('completed'),
  extractionNotes: jsonb('extraction_notes').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('ocr_extractions_receipt_idx').on(table.receiptId),
  index('ocr_extractions_payment_req_idx').on(table.paymentRequestId),
]);

// -----------------------------------------------------------------------------
// 8. Payments (Core verification records)
// -----------------------------------------------------------------------------
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentRequestId: uuid('payment_request_id').notNull().unique().references(() => paymentRequests.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  receiptId: uuid('receipt_id').references(() => receipts.id, { onDelete: 'set null' }),
  ocrExtractionId: uuid('ocr_extraction_id').references(() => ocrExtractions.id, { onDelete: 'set null' }),
  status: text('status', { enum: paymentRequestStatuses }).notNull().default('awaiting_payment'),
  verificationMethod: text('verification_method', { enum: verificationMethods }),
  amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('PKR'),
  transactionReference: text('transaction_reference'),
  payerIdentifier: text('payer_identifier'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  manualReviewNotes: text('manual_review_notes'),
  manualReviewedBy: text('manual_reviewed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('payments_tenant_idx').on(table.tenantId),
  index('payments_status_idx').on(table.status),
  index('payments_txn_ref_idx').on(table.tenantId, table.transactionReference),
]);

// -----------------------------------------------------------------------------
// 9. Trusted Payment Evidence (External API callbacks or authorized sources)
// -----------------------------------------------------------------------------
export const trustedPaymentEvidence = pgTable('trusted_payment_evidence', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  providerCode: text('provider_code').notNull(),
  providerTransactionId: text('provider_transaction_id').notNull(),
  evidenceType: text('evidence_type', { enum: ['api_callback', 'statement_reconciliation', 'authorized_manual_entry'] }).notNull(),
  amountPaisa: bigint('amount_paisa', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('PKR'),
  rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().default({}),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
  isMock: boolean('is_mock').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('trusted_evidence_tenant_txn_idx').on(table.tenantId, table.providerCode, table.providerTransactionId),
]);

// -----------------------------------------------------------------------------
// 10. Verification Checks (Audit breakdown of deterministic rules)
// -----------------------------------------------------------------------------
export const verificationChecks = pgTable('verification_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  checkName: text('check_name').notNull(),
  passed: boolean('passed').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('verification_checks_payment_idx').on(table.paymentId),
]);

// -----------------------------------------------------------------------------
// 11. Webhook Endpoints
// -----------------------------------------------------------------------------
export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret: text('secret').notNull(), // HMAC secret
  description: text('description').notNull().default(''),
  events: jsonb('events').$type<string[]>().notNull().default(['*']),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('webhook_endpoints_tenant_idx').on(table.tenantId),
]);

// -----------------------------------------------------------------------------
// 12. Webhook Events
// -----------------------------------------------------------------------------
export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('webhook_events_tenant_idx').on(table.tenantId),
]);

// -----------------------------------------------------------------------------
// 13. Webhook Deliveries
// -----------------------------------------------------------------------------
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookEventId: uuid('webhook_event_id').notNull().references(() => webhookEvents.id, { onDelete: 'cascade' }),
  webhookEndpointId: uuid('webhook_endpoint_id').notNull().references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull().default(1),
  status: text('status', { enum: ['pending', 'success', 'failed', 'retrying'] }).notNull().default('pending'),
  httpStatusCode: integer('http_status_code'),
  requestHeaders: jsonb('request_headers').$type<Record<string, string>>().default({}),
  requestBody: text('request_body').notNull(),
  responseBody: text('response_body'),
  errorMessage: text('error_message'),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('webhook_deliveries_event_idx').on(table.webhookEventId),
  index('webhook_deliveries_tenant_idx').on(table.tenantId),
]);

// -----------------------------------------------------------------------------
// 14. Idempotency Records
// -----------------------------------------------------------------------------
export const idempotencyRecords = pgTable('idempotency_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  idempotencyKey: text('idempotency_key').notNull(),
  requestMethod: text('request_method').notNull(),
  requestPath: text('request_path').notNull(),
  requestHash: text('request_hash').notNull(),
  responseStatus: integer('response_status').notNull(),
  responseHeaders: jsonb('response_headers').$type<Record<string, string>>().default({}),
  responseBody: text('response_body').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('idempotency_tenant_key_idx').on(table.tenantId, table.idempotencyKey),
]);

// -----------------------------------------------------------------------------
// 15. Audit Events
// -----------------------------------------------------------------------------
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  actorType: text('actor_type', { enum: ['api_key', 'user', 'system'] }).notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('audit_events_tenant_idx').on(table.tenantId),
  index('audit_events_entity_idx').on(table.entityType, table.entityId),
]);

// -----------------------------------------------------------------------------
// 16. Trusted Bank Senders (Allowed email whitelist for automated bank alert ingestion)
// -----------------------------------------------------------------------------
export const trustedBankSenders = pgTable('trusted_bank_senders', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  senderEmail: text('sender_email').notNull(),
  senderName: text('sender_name').notNull(),
  providerCode: text('provider_code').notNull(), // 'meezan_bank' | 'hbl' | 'easypaisa' | 'jazzcash' | 'custom'
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('trusted_senders_tenant_email_idx').on(table.tenantId, table.senderEmail),
]);

// -----------------------------------------------------------------------------
// Drizzle Relations
// -----------------------------------------------------------------------------
export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(tenantUsers),
  apiKeys: many(apiKeys),
  paymentMethods: many(paymentMethods),
  paymentRequests: many(paymentRequests),
  payments: many(payments),
  webhookEndpoints: many(webhookEndpoints),
  auditEvents: many(auditEvents),
}));

export const paymentRequestsRelations = relations(paymentRequests, ({ one, many }) => ({
  tenant: one(tenants, { fields: [paymentRequests.tenantId], references: [tenants.id] }),
  receipts: many(receipts),
  payment: one(payments, { fields: [paymentRequests.id], references: [payments.paymentRequestId] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [payments.tenantId], references: [tenants.id] }),
  paymentRequest: one(paymentRequests, { fields: [payments.paymentRequestId], references: [paymentRequests.id] }),
  receipt: one(receipts, { fields: [payments.receiptId], references: [receipts.id] }),
  ocrExtraction: one(ocrExtractions, { fields: [payments.ocrExtractionId], references: [ocrExtractions.id] }),
  verificationChecks: many(verificationChecks),
  evidence: many(trustedPaymentEvidence),
}));
