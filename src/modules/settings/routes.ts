import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { authenticateApiKey, requireScope } from '../auth/index.js';
import { generateApiKey } from '../../utils/crypto.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { AuditLogger } from '../audit/index.js';

const CreateApiKeySchema = z.object({
  label: z.string().min(2, 'label is required'),
  environment: z.enum(['test', 'live']).default('test'),
  scopes: z.array(z.string()).default(['*']),
});

const CreatePaymentMethodSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
  account_title: z.string().min(2),
  account_identifier: z.string().min(3),
  bank_name: z.string().optional(),
  instructions: z.string().min(5),
  min_amount_paisa: z.number().int().positive().default(100),
  max_amount_paisa: z.number().int().positive().default(100000000),
  is_active: z.boolean().default(true),
});

const UpdatePaymentMethodSchema = z.object({
  name: z.string().optional(),
  account_title: z.string().optional(),
  account_identifier: z.string().optional(),
  bank_name: z.string().optional(),
  instructions: z.string().optional(),
  min_amount_paisa: z.number().int().positive().optional(),
  max_amount_paisa: z.number().int().positive().optional(),
  is_active: z.boolean().optional(),
});

const CreateWebhookEndpointSchema = z.object({
  url: z.string().url('A valid HTTPS or HTTP URL is required'),
  description: z.string().default(''),
  events: z.array(z.string()).default(['*']),
});

export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticateApiKey);

  // ---------------------------------------------------------------------------
  // API KEYS
  // ---------------------------------------------------------------------------
  fastify.get('/v1/api-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const db = await getDb();

    const res = await db.execute(sql`
      SELECT id, key_prefix, label, environment, scopes, is_revoked, revoked_at, last_used_at, created_at
      FROM api_keys
      WHERE tenant_id = ${tenant.id}
      ORDER BY created_at DESC
    `);

    reply.send({ items: res.rows });
  });

  fastify.post('/v1/api-keys', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const parse = CreateApiKeySchema.safeParse(request.body);
    if (!parse.success) {
      reply.status(400).send({ statusCode: 400, error: 'Bad Request', details: parse.error.flatten() });
      return;
    }

    const { label, environment, scopes } = parse.data;
    const { rawKey, keyPrefix, keyHash } = generateApiKey(environment);
    const db = await getDb();
    const keyId = crypto.randomUUID();

    await db.execute(sql`
      INSERT INTO api_keys (id, tenant_id, key_hash, key_prefix, label, environment, scopes)
      VALUES (${keyId}, ${tenant.id}, ${keyHash}, ${keyPrefix}, ${label}, ${environment}, ${JSON.stringify(scopes)}::jsonb)
    `);

    await AuditLogger.log({
      tenantId: tenant.id,
      actorType: 'api_key',
      actorId: tenant.apiKeyId,
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: keyId,
      metadata: { label, environment, keyPrefix },
      ipAddress: request.ip,
    });

    reply.status(201).send({
      id: keyId,
      label,
      environment,
      key_prefix: keyPrefix,
      scopes,
      secret_key: rawKey,
      warning: 'Save this API secret key immediately. It is shown only once and cannot be retrieved again.',
      created_at: new Date().toISOString(),
    });
  });

  fastify.post('/v1/api-keys/:id/revoke', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id } = request.params;
    const db = await getDb();

    const res = await db.execute(sql`
      UPDATE api_keys
      SET is_revoked = TRUE, revoked_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenant.id}
      RETURNING id, key_prefix, label
    `);

    if (res.rows.length === 0) {
      reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'API key not found.' });
      return;
    }

    await AuditLogger.log({
      tenantId: tenant.id,
      actorType: 'api_key',
      actorId: tenant.apiKeyId,
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: id,
      ipAddress: request.ip,
    });

    reply.send({ id, is_revoked: true, message: 'API key successfully revoked.' });
  });

  fastify.post('/v1/api-keys/:id/rotate', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id } = request.params;
    const db = await getDb();

    // Fetch existing key details
    const existing = await db.execute(sql`
      SELECT label, environment, scopes FROM api_keys WHERE id = ${id} AND tenant_id = ${tenant.id} LIMIT 1
    `);

    if (existing.rows.length === 0) {
      reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'API key not found.' });
      return;
    }

    const oldKey = existing.rows[0];

    // Revoke old key
    await db.execute(sql`
      UPDATE api_keys SET is_revoked = TRUE, revoked_at = NOW(), updated_at = NOW() WHERE id = ${id}
    `);

    // Create new key with same config
    const { rawKey, keyPrefix, keyHash } = generateApiKey(oldKey.environment as 'test' | 'live');
    const newKeyId = crypto.randomUUID();

    await db.execute(sql`
      INSERT INTO api_keys (id, tenant_id, key_hash, key_prefix, label, environment, scopes)
      VALUES (${newKeyId}, ${tenant.id}, ${keyHash}, ${keyPrefix}, ${oldKey.label}, ${oldKey.environment}, ${JSON.stringify(oldKey.scopes)}::jsonb)
    `);

    reply.send({
      revoked_key_id: id,
      new_key: {
        id: newKeyId,
        label: oldKey.label,
        environment: oldKey.environment,
        key_prefix: keyPrefix,
        secret_key: rawKey,
        warning: 'Save this rotated secret key immediately. It is shown only once.',
      },
    });
  });

  // ---------------------------------------------------------------------------
  // PAYMENT METHODS
  // ---------------------------------------------------------------------------
  fastify.get('/v1/payment-methods', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const db = await getDb();

    const res = await db.execute(sql`
      SELECT * FROM payment_methods WHERE tenant_id = ${tenant.id} ORDER BY code ASC
    `);

    reply.send({ items: res.rows });
  });

  fastify.post('/v1/payment-methods', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const parse = CreatePaymentMethodSchema.safeParse(request.body);
    if (!parse.success) {
      reply.status(400).send({ statusCode: 400, error: 'Bad Request', details: parse.error.flatten() });
      return;
    }

    const d = parse.data;
    const db = await getDb();
    const id = crypto.randomUUID();

    await db.execute(sql`
      INSERT INTO payment_methods (
        id, tenant_id, code, name, account_title, account_identifier,
        bank_name, instructions, min_amount_paisa, max_amount_paisa, is_active
      ) VALUES (
        ${id}, ${tenant.id}, ${d.code.toLowerCase()}, ${d.name}, ${d.account_title},
        ${d.account_identifier}, ${d.bank_name ?? null}, ${d.instructions},
        ${d.min_amount_paisa}, ${d.max_amount_paisa}, ${d.is_active}
      )
      ON CONFLICT (tenant_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        account_title = EXCLUDED.account_title,
        account_identifier = EXCLUDED.account_identifier,
        bank_name = EXCLUDED.bank_name,
        instructions = EXCLUDED.instructions,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
    `);

    reply.status(201).send({ id, ...d });
  });

  fastify.put('/v1/payment-methods/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id } = request.params;
    const parse = UpdatePaymentMethodSchema.safeParse(request.body);
    if (!parse.success) {
      reply.status(400).send({ statusCode: 400, error: 'Bad Request', details: parse.error.flatten() });
      return;
    }

    const d = parse.data;
    const db = await getDb();

    const res = await db.execute(sql`
      UPDATE payment_methods
      SET name = COALESCE(${d.name ?? null}, name),
          account_title = COALESCE(${d.account_title ?? null}, account_title),
          account_identifier = COALESCE(${d.account_identifier ?? null}, account_identifier),
          bank_name = COALESCE(${d.bank_name ?? null}, bank_name),
          instructions = COALESCE(${d.instructions ?? null}, instructions),
          is_active = COALESCE(${d.is_active ?? null}, is_active),
          min_amount_paisa = COALESCE(${d.min_amount_paisa ?? null}, min_amount_paisa),
          max_amount_paisa = COALESCE(${d.max_amount_paisa ?? null}, max_amount_paisa),
          updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenant.id}
      RETURNING *
    `);

    if (res.rows.length === 0) {
      reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Payment method not found.' });
      return;
    }

    reply.send(res.rows[0]);
  });

  // ---------------------------------------------------------------------------
  // WEBHOOK ENDPOINTS
  // ---------------------------------------------------------------------------
  fastify.get('/v1/webhooks', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const db = await getDb();

    const res = await db.execute(sql`
      SELECT id, url, description, events, is_active, created_at, updated_at
      FROM webhook_endpoints
      WHERE tenant_id = ${tenant.id}
      ORDER BY created_at DESC
    `);

    reply.send({ items: res.rows });
  });

  fastify.post('/v1/webhooks', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const parse = CreateWebhookEndpointSchema.safeParse(request.body);
    if (!parse.success) {
      reply.status(400).send({ statusCode: 400, error: 'Bad Request', details: parse.error.flatten() });
      return;
    }

    const { url, description, events } = parse.data;
    const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
    const id = crypto.randomUUID();
    const db = await getDb();

    await db.execute(sql`
      INSERT INTO webhook_endpoints (id, tenant_id, url, secret, description, events, is_active)
      VALUES (${id}, ${tenant.id}, ${url}, ${secret}, ${description}, ${JSON.stringify(events)}::jsonb, TRUE)
    `);

    reply.status(201).send({
      id,
      url,
      secret,
      description,
      events,
      is_active: true,
      created_at: new Date().toISOString(),
      warning: 'Store this webhook secret securely. It is used to verify HMAC-SHA256 signatures.',
    });
  });

  fastify.post('/v1/webhooks/:id/test', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id } = request.params;
    const db = await getDb();

    const epRes = await db.execute(sql`
      SELECT * FROM webhook_endpoints WHERE id = ${id} AND tenant_id = ${tenant.id} LIMIT 1
    `);

    if (epRes.rows.length === 0) {
      reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Webhook endpoint not found.' });
      return;
    }

    const ep = epRes.rows[0];
    const eventId = crypto.randomUUID();

    const testPayload = {
      id: eventId,
      eventType: 'webhook.ping',
      createdAt: new Date().toISOString(),
      paymentRequestId: 'pr_test_ping_0000',
      orderReference: 'TEST_ORDER_PING',
      amountPaisa: 10000,
      currency: 'PKR',
      status: 'verified',
      verificationMethod: 'provider_verified',
      data: { message: 'SysGalaxy Webhook Test Ping' },
    };

    const deliveryResult = await WebhookDispatcher.dispatchToEndpoint(
      eventId,
      id,
      tenant.id,
      ep.url as string,
      ep.secret as string,
      testPayload,
      1
    );

    reply.send({
      message: 'Test ping webhook dispatched.',
      delivery: deliveryResult,
    });
  });

  fastify.get('/v1/webhooks/deliveries', async (request: FastifyRequest<{
    Querystring: {
      limit?: string;
      offset?: string;
    };
  }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { limit = '50', offset = '0' } = request.query;
    const db = await getDb();

    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    const res = await db.execute(sql`
      SELECT
        d.id,
        d.webhook_event_id,
        d.webhook_endpoint_id,
        d.attempt_number,
        d.status,
        d.http_status_code,
        d.error_message,
        d.created_at,
        e.event_type,
        ep.url as endpoint_url
      FROM webhook_deliveries d
      JOIN webhook_events e ON e.id = d.webhook_event_id
      JOIN webhook_endpoints ep ON ep.id = d.webhook_endpoint_id
      WHERE d.tenant_id = ${tenant.id}
      ORDER BY d.created_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    `);

    reply.send({ items: res.rows });
  });

  fastify.post('/v1/webhooks/deliveries/:id/retry', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id } = request.params;

    try {
      const success = await WebhookDispatcher.retryDelivery(id, tenant.id);
      reply.send({ success, message: 'Delivery retry attempted.' });
    } catch (err: any) {
      reply.status(404).send({ statusCode: 404, error: 'Not Found', message: err.message });
    }
  });
}
