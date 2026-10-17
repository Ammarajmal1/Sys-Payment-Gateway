import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import { authenticateApiKey, requireScope } from '../auth/index.js';
import { AuditLogger } from '../audit/index.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { formatPaisa } from '../../utils/currency.js';

const ReviewApproveSchema = z.object({
  evidence_reference: z.string().min(3, 'evidence_reference is required (e.g. Bank Statement Entry #, SMS Ref)'),
  notes: z.string().min(5, 'Reviewer explanation notes required for manual approval audit trail'),
  reviewer_name: z.string().optional().default('Authorized Merchant Officer'),
});

const ReviewRejectSchema = z.object({
  reason: z.string().min(5, 'Specific rejection reason is required'),
  reviewer_name: z.string().optional().default('Authorized Merchant Officer'),
});

export async function paymentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticateApiKey);

  // ---------------------------------------------------------------------------
  // 1. GET /v1/payments (List payments)
  // ---------------------------------------------------------------------------
  fastify.get('/v1/payments', async (request: FastifyRequest<{
    Querystring: {
      status?: string;
      verification_method?: string;
      limit?: string;
      offset?: string;
    };
  }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { status, verification_method, limit = '20', offset = '0' } = request.query;
    const db = await getDb();

    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    let query = sql`
      SELECT
        p.*,
        pr.order_reference,
        pr.payment_method_code,
        pr.request_reference
      FROM payments p
      JOIN payment_requests pr ON pr.id = p.payment_request_id
      WHERE p.tenant_id = ${tenant.id}
    `;

    if (status) {
      query = sql`${query} AND p.status = ${status}`;
    }
    if (verification_method) {
      query = sql`${query} AND p.verification_method = ${verification_method}`;
    }

    query = sql`${query} ORDER BY p.created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`;

    const res = await db.execute(query);

    const items = res.rows.map((row) => ({
      id: row.id,
      payment_request_id: row.payment_request_id,
      order_reference: row.order_reference,
      gateway_reference: row.request_reference,
      payment_method_code: row.payment_method_code,
      amount_paisa: Number(row.amount_paisa),
      amount_formatted: formatPaisa(Number(row.amount_paisa), row.currency as string),
      currency: row.currency,
      status: row.status,
      verification_method: row.verification_method ?? null,
      transaction_reference: row.transaction_reference ?? null,
      rejection_reason: row.rejection_reason ?? null,
      verified_at: row.verified_at ?? null,
      created_at: row.created_at,
    }));

    reply.send({
      items,
      limit: limitNum,
      offset: offsetNum,
      count: items.length,
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /v1/payments/:id (Retrieve payment)
  // ---------------------------------------------------------------------------
  fastify.get('/v1/payments/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id } = request.params;
    const db = await getDb();

    const res = await db.execute(sql`
      SELECT
        p.*,
        pr.order_reference,
        pr.request_reference,
        pr.payment_method_code,
        pr.customer_name,
        pr.customer_email,
        pr.customer_phone,
        r.original_filename,
        r.sha256_hash as receipt_sha256,
        r.file_size_bytes as receipt_size,
        o.raw_text as ocr_text,
        o.confidence_score as ocr_confidence,
        o.detected_provider as ocr_provider,
        o.extracted_amount_paisa,
        o.extracted_transaction_id,
        o.status as ocr_status
      FROM payments p
      JOIN payment_requests pr ON pr.id = p.payment_request_id
      LEFT JOIN receipts r ON r.id = p.receipt_id
      LEFT JOIN ocr_extractions o ON o.id = p.ocr_extraction_id
      WHERE p.id = ${id} AND p.tenant_id = ${tenant.id}
      LIMIT 1
    `);

    if (res.rows.length === 0) {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment not found.',
      });
      return;
    }

    const row = res.rows[0];

    // Fetch checks
    const checksRes = await db.execute(sql`
      SELECT check_name, passed, details, created_at
      FROM verification_checks
      WHERE payment_id = ${row.id}
      ORDER BY created_at ASC
    `);

    reply.send({
      id: row.id,
      payment_request_id: row.payment_request_id,
      order_reference: row.order_reference,
      gateway_reference: row.request_reference,
      payment_method_code: row.payment_method_code,
      amount_paisa: Number(row.amount_paisa),
      amount_formatted: formatPaisa(Number(row.amount_paisa), row.currency as string),
      currency: row.currency,
      status: row.status,
      verification_method: row.verification_method ?? null,
      transaction_reference: row.transaction_reference ?? null,
      rejection_reason: row.rejection_reason ?? null,
      manual_review_notes: row.manual_review_notes ?? null,
      manual_reviewed_by: row.manual_reviewed_by ?? null,
      verified_at: row.verified_at ?? null,
      rejected_at: row.rejected_at ?? null,
      created_at: row.created_at,
      customer: {
        name: row.customer_name ?? null,
        email: row.customer_email ?? null,
        phone: row.customer_phone ?? null,
      },
      receipt: row.receipt_id
        ? {
            id: row.receipt_id,
            filename: row.original_filename,
            sha256_hash: row.receipt_sha256,
            file_size_bytes: row.receipt_size,
          }
        : null,
      ocr: row.ocr_extraction_id
        ? {
            id: row.ocr_extraction_id,
            status: row.ocr_status,
            confidence: row.ocr_confidence,
            detected_provider: row.ocr_provider,
            extracted_amount_paisa: row.extracted_amount_paisa,
            extracted_transaction_id: row.extracted_transaction_id,
            raw_text: row.ocr_text,
          }
        : null,
      verification_checks: checksRes.rows,
    });
  });

  // ---------------------------------------------------------------------------
  // 3. POST /v1/payments/:id/review/approve (Manual approval)
  // ---------------------------------------------------------------------------
  fastify.post('/v1/payments/:id/review/approve', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id: paymentId } = request.params;
    const db = await getDb();

    const parseResult = ReviewApproveSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        details: parseResult.error.flatten(),
      });
      return;
    }

    const { evidence_reference, notes, reviewer_name } = parseResult.data;

    // Retrieve payment
    const paymentRes = await db.execute(sql`
      SELECT p.*, pr.order_reference, pr.id as pr_id
      FROM payments p
      JOIN payment_requests pr ON pr.id = p.payment_request_id
      WHERE p.id = ${paymentId} AND p.tenant_id = ${tenant.id}
      LIMIT 1
    `);

    if (paymentRes.rows.length === 0) {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment not found.',
      });
      return;
    }

    const payment = paymentRes.rows[0];

    if (payment.status === 'verified') {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Payment is already verified.',
      });
      return;
    }

    const auditNotes = `Evidence Ref: ${evidence_reference} | Notes: ${notes}`;

    // Update payment to verified
    await db.execute(sql`
      UPDATE payments
      SET status = 'verified',
          verification_method = 'manual_verified',
          verified_at = NOW(),
          manual_reviewed_by = ${reviewer_name},
          manual_review_notes = ${auditNotes},
          updated_at = NOW()
      WHERE id = ${paymentId}
    `);

    // Update payment request
    await db.execute(sql`
      UPDATE payment_requests
      SET status = 'verified',
          verification_method = 'manual_verified',
          updated_at = NOW()
      WHERE id = ${payment.pr_id}
    `);

    // Record trusted evidence
    await db.execute(sql`
      INSERT INTO trusted_payment_evidence (
        payment_id, tenant_id, provider_code, provider_transaction_id,
        evidence_type, amount_paisa, currency, raw_payload, is_mock
      ) VALUES (
        ${paymentId}, ${tenant.id}, 'manual_reconciliation', ${evidence_reference},
        'authorized_manual_entry', ${payment.amount_paisa}, ${payment.currency},
        ${JSON.stringify({ reviewer: reviewer_name, notes })}::jsonb, FALSE
      )
    `);

    // Audit log
    await AuditLogger.log({
      tenantId: tenant.id,
      actorType: 'api_key',
      actorId: tenant.apiKeyId,
      action: 'payment.manually_approved',
      entityType: 'payment',
      entityId: paymentId,
      metadata: { evidence_reference, reviewer_name, notes },
      ipAddress: request.ip,
    });

    // Webhook notification
    await WebhookDispatcher.publishEvent(
      tenant.id,
      'payment.verified',
      payment.pr_id as string,
      payment.order_reference as string,
      Number(payment.amount_paisa),
      payment.currency as string,
      'verified',
      'manual_verified',
      {
        evidence_reference,
        reviewed_by: reviewer_name,
        verification_method: 'manual_verified',
      }
    );

    reply.send({
      id: paymentId,
      status: 'verified',
      verification_method: 'manual_verified',
      verified_at: new Date().toISOString(),
      reviewed_by: reviewer_name,
      evidence_reference,
      message: 'Payment successfully approved through authorized manual review.',
    });
  });

  // ---------------------------------------------------------------------------
  // 4. POST /v1/payments/:id/review/reject (Manual rejection)
  // ---------------------------------------------------------------------------
  fastify.post('/v1/payments/:id/review/reject', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id: paymentId } = request.params;
    const db = await getDb();

    const parseResult = ReviewRejectSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        details: parseResult.error.flatten(),
      });
      return;
    }

    const { reason, reviewer_name } = parseResult.data;

    // Retrieve payment
    const paymentRes = await db.execute(sql`
      SELECT p.*, pr.order_reference, pr.id as pr_id
      FROM payments p
      JOIN payment_requests pr ON pr.id = p.payment_request_id
      WHERE p.id = ${paymentId} AND p.tenant_id = ${tenant.id}
      LIMIT 1
    `);

    if (paymentRes.rows.length === 0) {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment not found.',
      });
      return;
    }

    const payment = paymentRes.rows[0];

    // Update payment to rejected
    await db.execute(sql`
      UPDATE payments
      SET status = 'rejected',
          verification_method = NULL,
          rejected_at = NOW(),
          rejection_reason = ${reason},
          manual_reviewed_by = ${reviewer_name},
          updated_at = NOW()
      WHERE id = ${paymentId}
    `);

    // Update payment request
    await db.execute(sql`
      UPDATE payment_requests
      SET status = 'rejected',
          verification_method = NULL,
          updated_at = NOW()
      WHERE id = ${payment.pr_id}
    `);

    // Audit log
    await AuditLogger.log({
      tenantId: tenant.id,
      actorType: 'api_key',
      actorId: tenant.apiKeyId,
      action: 'payment.manually_rejected',
      entityType: 'payment',
      entityId: paymentId,
      metadata: { reason, reviewer_name },
      ipAddress: request.ip,
    });

    // Webhook notification
    await WebhookDispatcher.publishEvent(
      tenant.id,
      'payment.rejected',
      payment.pr_id as string,
      payment.order_reference as string,
      Number(payment.amount_paisa),
      payment.currency as string,
      'rejected',
      null,
      {
        rejection_reason: reason,
        reviewed_by: reviewer_name,
      }
    );

    reply.send({
      id: paymentId,
      status: 'rejected',
      verification_method: null,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
      reviewed_by: reviewer_name,
      message: 'Payment rejected.',
    });
  });
}
