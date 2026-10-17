import { FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';

/**
 * Handle idempotency check before route execution
 */
export async function checkIdempotency(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const idempotencyKey = request.headers['idempotency-key'];

  if (!idempotencyKey || typeof idempotencyKey !== 'string' || !request.tenant) {
    return false; // Proceed with normal execution
  }

  const cleanKey = idempotencyKey.trim();
  if (cleanKey.length === 0) return false;

  const db = await getDb();
  const existing = await db.execute(sql`
    SELECT response_status, response_headers, response_body
    FROM idempotency_records
    WHERE tenant_id = ${request.tenant.id}
      AND idempotency_key = ${cleanKey}
      AND expires_at > NOW()
    LIMIT 1
  `);

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    const status = row.response_status as number;
    const body = row.response_body as string;

    reply
      .status(status)
      .header('X-Cache-Lookup', 'IDEMPOTENT_HIT')
      .header('Content-Type', 'application/json')
      .send(body);

    return true; // Short-circuit route execution
  }

  return false;
}

/**
 * Store successful response under idempotency key
 */
export async function saveIdempotencyRecord(
  tenantId: string,
  idempotencyKey: string,
  requestMethod: string,
  requestPath: string,
  responseStatus: number,
  responseBody: unknown
): Promise<void> {
  const db = await getDb();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  const serializedBody = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
  const requestHash = crypto.createHash('sha256').update(`${requestMethod}:${requestPath}`).digest('hex');

  await db.execute(sql`
    INSERT INTO idempotency_records (
      tenant_id, idempotency_key, request_method, request_path,
      request_hash, response_status, response_headers, response_body, expires_at
    ) VALUES (
      ${tenantId}, ${idempotencyKey}, ${requestMethod}, ${requestPath},
      ${requestHash}, ${responseStatus}, '{"content-type":"application/json"}'::jsonb,
      ${serializedBody}, ${expiresAt.toISOString()}
    )
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  `);
}
