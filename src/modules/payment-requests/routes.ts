import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { authenticateApiKey, requireScope } from '../auth/index.js';
import { checkIdempotency, saveIdempotencyRecord } from '../idempotency/index.js';
import { AuditLogger } from '../audit/index.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { getStorageAdapter } from '../../storage/index.js';
import { validateReceiptFile } from '../receipts/validator.js';
import { runOcrOnBuffer, parseReceiptText } from '../ocr/index.js';
import { VerificationEngine } from '../verification/engine.js';
import { rupeesToPaisa, formatPaisa } from '../../utils/currency.js';

const CreatePaymentRequestSchema = z.object({
  order_reference: z.string().min(1, 'order_reference is required'),
  amount_paisa: z.number().int().positive().optional(),
  amount: z.number().positive().optional(),
  currency: z.string().default('PKR'),
  payment_method_code: z.string().min(1, 'payment_method_code is required'),
  customer_reference: z.string().optional(),
  customer_name: z.string().optional(),
  customer_email: z.string().email().optional(),
  customer_phone: z.string().optional(),
  expires_in_minutes: z.number().int().min(5).max(10080).default(60),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export async function paymentRequestRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticateApiKey);

  // ---------------------------------------------------------------------------
  // 1. POST /v1/payment-requests (Create payment request)
  // ---------------------------------------------------------------------------
  fastify.post('/v1/payment-requests', async (request: FastifyRequest, reply: FastifyReply) => {
    // Check idempotency
    const isIdempotentHit = await checkIdempotency(request, reply);
    if (isIdempotentHit) return;

    const tenant = request.tenant!;
    const parseResult = CreatePaymentRequestSchema.safeParse(request.body);

    if (!parseResult.success) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        details: parseResult.error.flatten(),
      });
      return;
    }

    const data = parseResult.data;
    const amountPaisa = data.amount_paisa ?? (data.amount ? rupeesToPaisa(data.amount) : null);

    if (!amountPaisa) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Either amount_paisa (integer paisa) or amount (PKR rupees) is required',
      });
      return;
    }

    const db = await getDb();

    // Verify payment method is configured and active for this tenant
    const methodResult = await db.execute(sql`
      SELECT id, code, name, account_title, account_identifier, bank_name, instructions, is_active, min_amount_paisa, max_amount_paisa
      FROM payment_methods
      WHERE tenant_id = ${tenant.id} AND code = ${data.payment_method_code.toLowerCase()}
      LIMIT 1
    `);

    if (methodResult.rows.length === 0) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Payment method '${data.payment_method_code}' is not configured for your merchant account.`,
      });
      return;
    }

    const method = methodResult.rows[0];
    if (!method.is_active) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Payment method '${data.payment_method_code}' is currently disabled.`,
      });
      return;
    }

    if (amountPaisa < (method.min_amount_paisa as number) || amountPaisa > (method.max_amount_paisa as number)) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `Amount must be between ${formatPaisa(method.min_amount_paisa as number)} and ${formatPaisa(method.max_amount_paisa as number)}`,
      });
      return;
    }

    const requestId = crypto.randomUUID();
    const requestReference = `pr_${tenant.environment}_${crypto.randomBytes(10).toString('hex')}`;
    const expiresAt = new Date(Date.now() + data.expires_in_minutes * 60 * 1000);

    // Insert payment request
    await db.execute(sql`
      INSERT INTO payment_requests (
        id, tenant_id, request_reference, order_reference, amount_paisa,
        currency, payment_method_code, customer_reference, customer_name,
        customer_email, customer_phone, status, expires_at, metadata
      ) VALUES (
        ${requestId}, ${tenant.id}, ${requestReference}, ${data.order_reference},
        ${amountPaisa}, ${data.currency}, ${data.payment_method_code},
        ${data.customer_reference ?? null}, ${data.customer_name ?? null},
        ${data.customer_email ?? null}, ${data.customer_phone ?? null},
        'awaiting_payment', ${expiresAt.toISOString()}, ${JSON.stringify(data.metadata)}::jsonb
      )
    `);

    // Insert initial payment tracking record
    const paymentId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO payments (
        id, payment_request_id, tenant_id, status, amount_paisa, currency
      ) VALUES (
        ${paymentId}, ${requestId}, ${tenant.id}, 'awaiting_payment', ${amountPaisa}, ${data.currency}
      )
    `);

    // Build user-friendly payment instructions
    const instructions = {
      payment_method: method.name,
      payment_method_code: method.code,
      account_title: method.account_title,
      account_identifier: method.account_identifier,
      bank_name: method.bank_name ?? null,
      amount_paisa: amountPaisa,
      amount_formatted: formatPaisa(amountPaisa, data.currency),
      gateway_reference: requestReference,
      order_reference: data.order_reference,
      step_by_step: method.instructions,
      expires_at: expiresAt.toISOString(),
      upload_receipt_endpoint: `/v1/payment-requests/${requestId}/receipt`,
    };

    const responsePayload = {
      id: requestId,
      reference: requestReference,
      order_reference: data.order_reference,
      amount_paisa: amountPaisa,
      currency: data.currency,
      status: 'awaiting_payment',
      verification_method: null,
      expires_at: expiresAt.toISOString(),
      instructions,
      created_at: new Date().toISOString(),
    };

    // Audit log
    await AuditLogger.log({
      tenantId: tenant.id,
      actorType: 'api_key',
      actorId: tenant.apiKeyId,
      action: 'payment_request.created',
      entityType: 'payment_request',
      entityId: requestId,
      metadata: { order_reference: data.order_reference, amount_paisa: amountPaisa },
      ipAddress: request.ip,
    });

    // Webhook notification
    await WebhookDispatcher.publishEvent(
      tenant.id,
      'payment.created',
      requestId,
      data.order_reference,
      amountPaisa,
      data.currency,
      'awaiting_payment',
      null,
      { request_reference: requestReference }
    );

    // Save idempotency record if key was provided
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey === 'string' && idempotencyKey.trim()) {
      await saveIdempotencyRecord(
        tenant.id,
        idempotencyKey.trim(),
        'POST',
        '/v1/payment-requests',
        201,
        responsePayload
      );
    }

    reply.status(201).send(responsePayload);
  });

  // ---------------------------------------------------------------------------
  // 2. GET /v1/payment-requests/:id (Retrieve payment request)
  // ---------------------------------------------------------------------------
  fastify.get('/v1/payment-requests/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id } = request.params;
    const db = await getDb();

    const res = await db.execute(sql`
      SELECT
        pr.*,
        p.id as payment_id,
        p.status as payment_status,
        p.verification_method,
        p.transaction_reference,
        p.rejection_reason,
        pm.name as method_name,
        pm.account_title,
        pm.account_identifier,
        pm.bank_name,
        pm.instructions as method_instructions
      FROM payment_requests pr
      LEFT JOIN payments p ON p.payment_request_id = pr.id
      LEFT JOIN payment_methods pm ON pm.tenant_id = pr.tenant_id AND pm.code = pr.payment_method_code
      WHERE pr.id = ${id} AND pr.tenant_id = ${tenant.id}
      LIMIT 1
    `);

    if (res.rows.length === 0) {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment request not found or access denied.',
      });
      return;
    }

    const row = res.rows[0];
    const amountPaisa = Number(row.amount_paisa);

    reply.send({
      id: row.id,
      reference: row.request_reference,
      order_reference: row.order_reference,
      amount_paisa: amountPaisa,
      amount_formatted: formatPaisa(amountPaisa, row.currency as string),
      currency: row.currency,
      payment_method_code: row.payment_method_code,
      status: row.status,
      verification_method: row.verification_method ?? null,
      transaction_reference: row.transaction_reference ?? null,
      rejection_reason: row.rejection_reason ?? null,
      expires_at: row.expires_at,
      created_at: row.created_at,
      instructions: {
        payment_method: row.method_name,
        account_title: row.account_title,
        account_identifier: row.account_identifier,
        bank_name: row.bank_name,
        step_by_step: row.method_instructions,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // 3. GET /v1/payment-requests (List payment requests)
  // ---------------------------------------------------------------------------
  fastify.get('/v1/payment-requests', async (request: FastifyRequest<{
    Querystring: {
      status?: string;
      order_reference?: string;
      limit?: string;
      offset?: string;
    };
  }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { status, order_reference, limit = '20', offset = '0' } = request.query;
    const db = await getDb();

    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    let query = sql`
      SELECT
        pr.*,
        p.verification_method,
        p.transaction_reference
      FROM payment_requests pr
      LEFT JOIN payments p ON p.payment_request_id = pr.id
      WHERE pr.tenant_id = ${tenant.id}
    `;

    if (status) {
      query = sql`${query} AND pr.status = ${status}`;
    }
    if (order_reference) {
      query = sql`${query} AND pr.order_reference = ${order_reference}`;
    }

    query = sql`${query} ORDER BY pr.created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`;

    const res = await db.execute(query);

    const items = res.rows.map((row) => ({
      id: row.id,
      reference: row.request_reference,
      order_reference: row.order_reference,
      amount_paisa: Number(row.amount_paisa),
      currency: row.currency,
      payment_method_code: row.payment_method_code,
      status: row.status,
      verification_method: row.verification_method ?? null,
      expires_at: row.expires_at,
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
  // 4. POST /v1/payment-requests/:id/cancel (Cancel payment request)
  // ---------------------------------------------------------------------------
  fastify.post('/v1/payment-requests/:id/cancel', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id } = request.params;
    const db = await getDb();

    const check = await db.execute(sql`
      SELECT id, status, order_reference, amount_paisa, currency
      FROM payment_requests
      WHERE id = ${id} AND tenant_id = ${tenant.id}
      LIMIT 1
    `);

    if (check.rows.length === 0) {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment request not found',
      });
      return;
    }

    const row = check.rows[0];
    if (row.status === 'verified') {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Cannot cancel an already verified payment request.',
      });
      return;
    }

    await db.execute(sql`
      UPDATE payment_requests
      SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
      WHERE id = ${id}
    `);

    await db.execute(sql`
      UPDATE payments
      SET status = 'cancelled', updated_at = NOW()
      WHERE payment_request_id = ${id}
    `);

    await WebhookDispatcher.publishEvent(
      tenant.id,
      'payment.cancelled',
      id,
      row.order_reference as string,
      Number(row.amount_paisa),
      row.currency as string,
      'cancelled',
      null
    );

    reply.send({
      id,
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    });
  });

  // ---------------------------------------------------------------------------
  // 5. POST /v1/payment-requests/:id/receipt (Upload customer receipt proof)
  // ---------------------------------------------------------------------------
  fastify.post('/v1/payment-requests/:id/receipt', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id: paymentRequestId } = request.params;
    const db = await getDb();

    // Verify payment request
    const prRes = await db.execute(sql`
      SELECT pr.*, pm.account_identifier as destination_account
      FROM payment_requests pr
      LEFT JOIN payment_methods pm ON pm.tenant_id = pr.tenant_id AND pm.code = pr.payment_method_code
      WHERE pr.id = ${paymentRequestId} AND pr.tenant_id = ${tenant.id}
      LIMIT 1
    `);

    if (prRes.rows.length === 0) {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment request not found or access denied.',
      });
      return;
    }

    const pr = prRes.rows[0];

    if (pr.status === 'verified') {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Payment request has already been verified.',
      });
      return;
    }

    if (pr.status === 'cancelled') {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Payment request was cancelled and cannot accept receipts.',
      });
      return;
    }

    // Get payment record
    const paymentRes = await db.execute(sql`
      SELECT id FROM payments WHERE payment_request_id = ${paymentRequestId} LIMIT 1
    `);
    const paymentId = paymentRes.rows[0].id as string;

    // Process multipart file upload
    const data = await request.file();
    if (!data) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'No file uploaded. Please upload a receipt screenshot via multipart/form-data with field name "file" or "receipt".',
      });
      return;
    }

    const fileBuffer = await data.toBuffer();
    const originalFilename = data.filename || 'receipt.png';

    // Validate file type, magic bytes, max size
    const validation = validateReceiptFile(fileBuffer, data.mimetype);
    if (!validation.isValid) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Unprocessable Entity',
        message: validation.error,
      });
      return;
    }

    // Save to private storage via StorageAdapter
    const storage = getStorageAdapter();
    const saved = await storage.saveFile(originalFilename, fileBuffer, validation.detectedMimeType!);

    // Insert receipt record
    const receiptId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO receipts (
        id, payment_request_id, tenant_id, original_filename, storage_path,
        mime_type, file_size_bytes, sha256_hash, upload_ip
      ) VALUES (
        ${receiptId}, ${paymentRequestId}, ${tenant.id}, ${originalFilename},
        ${saved.storagePath}, ${validation.detectedMimeType!}, ${saved.fileSizeBytes},
        ${saved.sha256Hash}, ${request.ip}
      )
    `);

    // Transition status to 'processing'
    await db.execute(sql`
      UPDATE payment_requests SET status = 'processing', updated_at = NOW() WHERE id = ${paymentRequestId}
    `);
    await db.execute(sql`
      UPDATE payments SET status = 'processing', receipt_id = ${receiptId}, updated_at = NOW() WHERE id = ${paymentId}
    `);

    // Run OCR (Extract untrusted fields)
    // Optional query param / header to pass text directly in fast unit tests:
    const mockOcrText = request.headers['x-test-ocr-text'];
    let ocrResult;
    if (typeof mockOcrText === 'string') {
      ocrResult = parseReceiptText(mockOcrText, 95);
    } else {
      ocrResult = await runOcrOnBuffer(fileBuffer, validation.detectedMimeType!);
    }

    const ocrId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO ocr_extractions (
        id, receipt_id, payment_request_id, tenant_id, raw_text,
        confidence_score, detected_provider, extracted_amount_paisa,
        extracted_currency, extracted_transaction_id, extracted_date_time,
        extracted_sender_name, extracted_sender_account, extracted_receiver_name,
        extracted_receiver_account, status, extraction_notes
      ) VALUES (
        ${ocrId}, ${receiptId}, ${paymentRequestId}, ${tenant.id},
        ${ocrResult.rawText}, ${ocrResult.confidenceScore}, ${ocrResult.detectedProvider ?? null},
        ${ocrResult.extractedAmountPaisa ?? null}, ${ocrResult.extractedCurrency ?? null},
        ${ocrResult.extractedTransactionId ?? null}, ${ocrResult.extractedDateTime ?? null},
        ${ocrResult.extractedSenderName ?? null}, ${ocrResult.extractedSenderAccount ?? null},
        ${ocrResult.extractedReceiverName ?? null}, ${ocrResult.extractedReceiverAccount ?? null},
        ${ocrResult.status}, ${JSON.stringify(ocrResult.extractionNotes)}::jsonb
      )
    `);

    // Update payment with OCR extraction reference
    await db.execute(sql`
      UPDATE payments
      SET ocr_extraction_id = ${ocrId},
          transaction_reference = ${ocrResult.extractedTransactionId ?? null}
      WHERE id = ${paymentId}
    `);

    // Check if matching trusted evidence already exists (e.g. from prior inbound bank email)
    let preExistingEvidence: any = undefined;
    if (ocrResult.extractedTransactionId) {
      const evidenceRes = await db.execute(sql`
        SELECT *
        FROM trusted_payment_evidence
        WHERE tenant_id = ${tenant.id}
          AND provider_transaction_id = ${ocrResult.extractedTransactionId}
          AND amount_paisa = ${Number(pr.amount_paisa)}
        LIMIT 1
      `);
      if (evidenceRes.rows.length > 0) {
        const ev = evidenceRes.rows[0];
        preExistingEvidence = {
          providerTransactionId: ev.provider_transaction_id as string,
          evidenceType: ev.evidence_type as 'statement_reconciliation',
          amountPaisa: Number(ev.amount_paisa),
          currency: ev.currency as string,
          isMock: ev.is_mock as boolean,
          rawPayload: (ev.raw_payload as Record<string, unknown>) ?? {},
        };
        // Link payment id to this evidence
        await db.execute(sql`
          UPDATE trusted_payment_evidence
          SET payment_id = ${paymentId}
          WHERE id = ${ev.id}
        `);
      }
    }

    // Run deterministic verification engine
    const verificationOutput = await VerificationEngine.evaluate({
      tenantId: tenant.id,
      paymentRequestId,
      paymentId,
      receiptId,
      receiptSha256Hash: saved.sha256Hash,
      expectedAmountPaisa: Number(pr.amount_paisa),
      expectedCurrency: pr.currency as string,
      paymentMethodCode: pr.payment_method_code as string,
      configuredDestinationAccount: (pr.destination_account as string) ?? undefined,
      expiresAt: new Date(pr.expires_at as string),
      ocrExtraction: ocrResult,
      trustedEvidence: preExistingEvidence,
    });

    // Update payment and payment request statuses based on verification result
    await db.execute(sql`
      UPDATE payment_requests
      SET status = ${verificationOutput.status},
          verification_method = ${verificationOutput.verificationMethod ?? null},
          updated_at = NOW()
      WHERE id = ${paymentRequestId}
    `);

    await db.execute(sql`
      UPDATE payments
      SET status = ${verificationOutput.status},
          verification_method = ${verificationOutput.verificationMethod ?? null},
          rejection_reason = ${verificationOutput.rejectionReason ?? null},
          updated_at = NOW()
      WHERE id = ${paymentId}
    `);

    // Publish webhooks
    await WebhookDispatcher.publishEvent(
      tenant.id,
      'receipt.uploaded',
      paymentRequestId,
      pr.order_reference as string,
      Number(pr.amount_paisa),
      pr.currency as string,
      verificationOutput.status,
      verificationOutput.verificationMethod,
      {
        receipt_id: receiptId,
        sha256_hash: saved.sha256Hash,
        ocr_status: ocrResult.status,
      }
    );

    const statusEventName =
      verificationOutput.status === 'verified'
        ? 'payment.verified'
        : verificationOutput.status === 'rejected'
        ? 'payment.rejected'
        : 'payment.pending_review';

    await WebhookDispatcher.publishEvent(
      tenant.id,
      statusEventName,
      paymentRequestId,
      pr.order_reference as string,
      Number(pr.amount_paisa),
      pr.currency as string,
      verificationOutput.status,
      verificationOutput.verificationMethod,
      {
        rejection_reason: verificationOutput.rejectionReason ?? null,
      }
    );

    reply.status(200).send({
      payment_request_id: paymentRequestId,
      payment_id: paymentId,
      receipt_id: receiptId,
      status: verificationOutput.status,
      verification_method: verificationOutput.verificationMethod,
      rejection_reason: verificationOutput.rejectionReason ?? null,
      ocr: {
        status: ocrResult.status,
        confidence: ocrResult.confidenceScore,
        detected_provider: ocrResult.detectedProvider ?? null,
        extracted_amount_paisa: ocrResult.extractedAmountPaisa ?? null,
        extracted_transaction_id: ocrResult.extractedTransactionId ?? null,
        extracted_date_time: ocrResult.extractedDateTime ?? null,
        untrusted_notice: 'OCR output is unauthenticated customer data and is not treated as payment confirmation.',
      },
      checks: verificationOutput.checks,
      message:
        verificationOutput.status === 'pending_review'
          ? 'Receipt accepted. Direct automated bank confirmation is unavailable. Sent to merchant manual review queue.'
          : verificationOutput.status === 'rejected'
          ? `Receipt rejected: ${verificationOutput.rejectionReason}`
          : 'Payment verified.',
    });
  });

  // ---------------------------------------------------------------------------
  // 6. GET /v1/payment-requests/:id/verification (Detailed verification audit)
  // ---------------------------------------------------------------------------
  fastify.get('/v1/payment-requests/:id/verification', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id: paymentRequestId } = request.params;
    const db = await getDb();

    const paymentRes = await db.execute(sql`
      SELECT p.*, r.sha256_hash, r.original_filename, o.raw_text, o.confidence_score, o.status as ocr_status
      FROM payments p
      LEFT JOIN receipts r ON r.id = p.receipt_id
      LEFT JOIN ocr_extractions o ON o.id = p.ocr_extraction_id
      WHERE p.payment_request_id = ${paymentRequestId} AND p.tenant_id = ${tenant.id}
      LIMIT 1
    `);

    if (paymentRes.rows.length === 0) {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Payment verification record not found.',
      });
      return;
    }

    const p = paymentRes.rows[0];

    const checksRes = await db.execute(sql`
      SELECT check_name, passed, details, created_at
      FROM verification_checks
      WHERE payment_id = ${p.id}
      ORDER BY created_at ASC
    `);

    reply.send({
      payment_request_id: paymentRequestId,
      payment_id: p.id,
      status: p.status,
      verification_method: p.verification_method ?? null,
      transaction_reference: p.transaction_reference ?? null,
      rejection_reason: p.rejection_reason ?? null,
      manual_review_notes: p.manual_review_notes ?? null,
      manual_reviewed_by: p.manual_reviewed_by ?? null,
      receipt: p.receipt_id
        ? {
            id: p.receipt_id,
            filename: p.original_filename,
            sha256_hash: p.sha256_hash,
          }
        : null,
      ocr: p.ocr_extraction_id
        ? {
            id: p.ocr_extraction_id,
            status: p.ocr_status,
            confidence: p.confidence_score,
            raw_text_snippet: (p.raw_text as string)?.slice(0, 300),
          }
        : null,
      checks: checksRes.rows,
    });
  });
}
