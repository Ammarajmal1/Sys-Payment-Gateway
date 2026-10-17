import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import { authenticateApiKey } from '../auth/index.js';
import { AuditLogger } from '../audit/index.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';
import { parseReceiptText } from '../ocr/index.js';
import { formatPaisa } from '../../utils/currency.js';
import { GmailBankAlertPoller } from './gmail-poller.js';

const InboundEmailSchema = z.object({
  sender_email: z.string().email().optional(),
  raw_email_text: z.string().optional(),
  transaction_id: z.string().optional(),
  amount_paisa: z.number().int().positive().optional(),
  currency: z.string().optional().default('PKR'),
  provider: z.string().optional().default('bank_transfer'),
  sender_identifier: z.string().optional(),
  sender_name: z.string().optional(),
  received_at: z.string().optional(),
});

const CreateTrustedSenderSchema = z.object({
  sender_email: z.string().min(3),
  sender_name: z.string().min(2),
  provider_code: z.string().min(2).default('bank_transfer'),
  is_active: z.boolean().default(true),
});

export async function bankFeedRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Exclude Google Cloud Pub/Sub push webhook from tenant Bearer API key authentication
    if (request.url.startsWith('/v1/bank-feeds/gmail/pubsub-webhook')) {
      return;
    }
    return authenticateApiKey(request, reply);
  });

  // ---------------------------------------------------------------------------
  // 1. POST /v1/bank-feeds/inbound-email (Ingest Bank Alert Email / SMS)
  // ---------------------------------------------------------------------------
  fastify.post('/v1/bank-feeds/inbound-email', async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const parsed = InboundEmailSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid inbound email payload.',
        details: parsed.error.flatten(),
      });
      return;
    }

    const data = parsed.data;
    const db = await getDb();

    // -------------------------------------------------------------------------
    // SECURITY CHECK: Trusted Bank Sender Whitelist Enforcement
    // -------------------------------------------------------------------------
    // If the sender_email is provided, verify against the tenant's trusted senders.
    // If tenant has active trusted senders, any email NOT in the whitelist is IGNORED!
    if (data.sender_email) {
      const trustedSendersRes = await db.execute(sql`
        SELECT sender_email, provider_code, sender_name
        FROM trusted_bank_senders
        WHERE tenant_id = ${tenant.id} AND is_active = TRUE
      `);

      if (trustedSendersRes.rows.length > 0) {
        const incomingEmail = data.sender_email.trim().toLowerCase();
        const incomingDomain = incomingEmail.split('@')[1];

        const isAllowed = trustedSendersRes.rows.some((row: any) => {
          const allowed = (row.sender_email as string).trim().toLowerCase();
          // Exact match OR domain wildcard (e.g. "@meezanbank.com" or "meezanbank.com")
          if (allowed === incomingEmail) return true;
          if (allowed.startsWith('@') && incomingEmail.endsWith(allowed)) return true;
          if (incomingDomain && (allowed === incomingDomain || allowed === `@${incomingDomain}`)) return true;
          return false;
        });

        if (!isAllowed) {
          // Log security event for audit trail
          await AuditLogger.log({
            tenantId: tenant.id,
            actorType: 'system',
            actorId: 'email_whitelist_filter',
            action: 'bank_feed.untrusted_sender_ignored',
            entityType: 'bank_feed',
            entityId: data.transaction_id || 'unknown',
            metadata: {
              sender_email: data.sender_email,
              reason: 'Sender is not in trusted bank senders whitelist',
            },
            ipAddress: request.ip,
          });

          reply.status(200).send({
            success: false,
            ignored: true,
            reason: 'UNTRUSTED_SENDER',
            message: `Security Protection: Email from '${data.sender_email}' was completely ignored because it is not in your configured Bank Senders whitelist.`,
            sender_email: data.sender_email,
          });
          return;
        }
      }
    }

    let transactionId = data.transaction_id;
    let amountPaisa = data.amount_paisa;
    let detectedProvider = data.provider;
    let sender = data.sender_identifier;

    // If raw email text was passed, use regex parser to extract fields
    if (data.raw_email_text && (!transactionId || !amountPaisa)) {
      const extracted = parseReceiptText(data.raw_email_text, 99);
      if (!transactionId && extracted.extractedTransactionId) {
        transactionId = extracted.extractedTransactionId;
      }
      if (!amountPaisa && extracted.extractedAmountPaisa) {
        amountPaisa = extracted.extractedAmountPaisa;
      }
      if (extracted.detectedProvider && extracted.detectedProvider !== 'other') {
        detectedProvider = extracted.detectedProvider;
      }
      if (!sender && extracted.extractedSenderAccount) {
        sender = extracted.extractedSenderAccount;
      }
    }

    if (!transactionId || !amountPaisa) {
      reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Could not extract both Transaction ID and Amount from the provided email payload.',
      });
      return;
    }

    const evidenceId = crypto.randomUUID();

    // 1. Store trusted evidence in database
    await db.execute(sql`
      INSERT INTO trusted_payment_evidence (
        id, tenant_id, provider_code, provider_transaction_id,
        evidence_type, amount_paisa, currency, raw_payload, is_mock
      ) VALUES (
        ${evidenceId}, ${tenant.id}, ${detectedProvider}, ${transactionId},
        'statement_reconciliation', ${amountPaisa}, ${data.currency},
        ${JSON.stringify({
          sender_email: data.sender_email ?? null,
          raw_text: data.raw_email_text ?? null,
          sender,
          received_at: data.received_at || new Date().toISOString(),
        })}::jsonb,
        FALSE
      )
    `);

    // 2. Cross-verify against existing pending/processing payments
    const pendingMatches = await db.execute(sql`
      SELECT
        p.id as payment_id,
        p.payment_request_id,
        p.amount_paisa,
        p.currency,
        p.status,
        pr.order_reference,
        pr.request_reference
      FROM payments p
      JOIN payment_requests pr ON pr.id = p.payment_request_id
      WHERE p.tenant_id = ${tenant.id}
        AND p.transaction_reference = ${transactionId}
        AND p.amount_paisa = ${amountPaisa}
        AND p.status IN ('pending_review', 'processing')
      LIMIT 1
    `);

    let autoVerified = false;
    let matchedPaymentId: string | null = null;
    let matchedOrderReference: string | null = null;

    if (pendingMatches.rows.length > 0) {
      const matched = pendingMatches.rows[0];
      matchedPaymentId = matched.payment_id as string;
      matchedOrderReference = matched.order_reference as string;
      autoVerified = true;

      // Update payment to verified (provider_verified)
      await db.execute(sql`
        UPDATE payments
        SET status = 'verified',
            verification_method = 'provider_verified',
            verified_at = NOW(),
            updated_at = NOW()
        WHERE id = ${matchedPaymentId}
      `);

      // Update payment request
      await db.execute(sql`
        UPDATE payment_requests
        SET status = 'verified',
            verification_method = 'provider_verified',
            updated_at = NOW()
        WHERE id = ${matched.payment_request_id}
      `);

      // Link payment_id to trusted evidence
      await db.execute(sql`
        UPDATE trusted_payment_evidence
        SET payment_id = ${matchedPaymentId}
        WHERE id = ${evidenceId}
      `);

      // Log verification check
      await db.execute(sql`
        INSERT INTO verification_checks (payment_id, tenant_id, check_name, passed, details)
        VALUES (
          ${matchedPaymentId},
          ${tenant.id},
          'TRUSTED_PROVIDER_EVIDENCE',
          TRUE,
          ${JSON.stringify({
            evidence_id: evidenceId,
            matched_via: 'inbound_bank_email_reconciliation',
            transaction_id: transactionId,
            amount_paisa: amountPaisa,
            sender_email: data.sender_email ?? 'verified_bank_source',
          })}::jsonb
        )
      `);

      // Audit log
      await AuditLogger.log({
        tenantId: tenant.id,
        actorType: 'system',
        actorId: 'bank_email_reconciler',
        action: 'payment.auto_verified_via_email',
        entityType: 'payment',
        entityId: matchedPaymentId,
        metadata: {
          transaction_id: transactionId,
          amount_paisa: amountPaisa,
          order_reference: matchedOrderReference,
          sender_email: data.sender_email ?? null,
        },
        ipAddress: request.ip,
      });

      // Dispatch webhook to merchant (e.g. TailorShop TPMS)
      await WebhookDispatcher.publishEvent(
        tenant.id,
        'payment.verified',
        matched.payment_request_id as string,
        matchedOrderReference,
        Number(matched.amount_paisa),
        matched.currency as string,
        'verified',
        'provider_verified',
        {
          transaction_reference: transactionId,
          evidence_type: 'bank_email_reconciliation',
          sender_email: data.sender_email ?? null,
          verified_at: new Date().toISOString(),
        }
      );
    }

    reply.status(201).send({
      success: true,
      evidence_id: evidenceId,
      transaction_id: transactionId,
      amount_paisa: amountPaisa,
      amount_formatted: formatPaisa(amountPaisa, data.currency),
      auto_verified: autoVerified,
      matched_payment_id: matchedPaymentId,
      matched_order_reference: matchedOrderReference,
      message: autoVerified
        ? `Transaction matched with order '${matchedOrderReference}' and verified automatically!`
        : 'Bank alert logged as trusted evidence. Will auto-verify matching payment when customer uploads proof.',
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /v1/bank-feeds (List recent bank email alerts / evidence)
  // ---------------------------------------------------------------------------
  fastify.get('/v1/bank-feeds', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const db = await getDb();

    const res = await db.execute(sql`
      SELECT
        e.id,
        e.payment_id,
        e.provider_code,
        e.provider_transaction_id,
        e.evidence_type,
        e.amount_paisa,
        e.currency,
        e.raw_payload,
        e.created_at,
        p.status as payment_status,
        pr.order_reference,
        pr.customer_name,
        pr.request_reference
      FROM trusted_payment_evidence e
      LEFT JOIN payments p ON p.id = e.payment_id
      LEFT JOIN payment_requests pr ON pr.id = p.payment_request_id
      WHERE e.tenant_id = ${tenant.id}
      ORDER BY e.created_at DESC
      LIMIT 100
    `);

    const items = res.rows.map((row: any) => ({
      id: row.id,
      payment_id: row.payment_id ?? null,
      provider_code: row.provider_code,
      transaction_id: row.provider_transaction_id,
      evidence_type: row.evidence_type,
      amount_paisa: Number(row.amount_paisa),
      amount_formatted: formatPaisa(Number(row.amount_paisa), row.currency as string),
      currency: row.currency,
      raw_payload: row.raw_payload,
      created_at: row.created_at,
      payment_status: row.payment_status ?? null,
      order_reference: row.order_reference ?? null,
      customer_name: row.customer_name ?? null,
      request_reference: row.request_reference ?? null,
    }));

    reply.send({ items, count: items.length });
  });

  // ---------------------------------------------------------------------------
  // 3. GET /v1/bank-feeds/trusted-senders (List Allowed Bank Sender Emails)
  // ---------------------------------------------------------------------------
  fastify.get('/v1/bank-feeds/trusted-senders', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const db = await getDb();

    const res = await db.execute(sql`
      SELECT id, sender_email, sender_name, provider_code, is_active, created_at
      FROM trusted_bank_senders
      WHERE tenant_id = ${tenant.id}
      ORDER BY created_at ASC
    `);

    reply.send({ items: res.rows, count: res.rows.length });
  });

  // ---------------------------------------------------------------------------
  // 4. POST /v1/bank-feeds/trusted-senders (Add a Trusted Bank Sender Email)
  // ---------------------------------------------------------------------------
  fastify.post('/v1/bank-feeds/trusted-senders', async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const parsed = CreateTrustedSenderSchema.safeParse(request.body);

    if (!parsed.success) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { sender_email, sender_name, provider_code, is_active } = parsed.data;
    const db = await getDb();
    const id = crypto.randomUUID();

    await db.execute(sql`
      INSERT INTO trusted_bank_senders (id, tenant_id, sender_email, sender_name, provider_code, is_active)
      VALUES (${id}, ${tenant.id}, ${sender_email.toLowerCase().trim()}, ${sender_name}, ${provider_code}, ${is_active})
      ON CONFLICT (tenant_id, sender_email) DO UPDATE SET
        sender_name = EXCLUDED.sender_name,
        provider_code = EXCLUDED.provider_code,
        is_active = EXCLUDED.is_active
    `);

    reply.status(201).send({
      id,
      sender_email: sender_email.toLowerCase().trim(),
      sender_name,
      provider_code,
      is_active,
      message: 'Trusted bank sender email added to whitelist successfully.',
    });
  });

  // ---------------------------------------------------------------------------
  // 5. DELETE /v1/bank-feeds/trusted-senders/:id (Remove from Whitelist)
  // ---------------------------------------------------------------------------
  fastify.delete('/v1/bank-feeds/trusted-senders/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const { id } = request.params;
    const db = await getDb();

    await db.execute(sql`
      DELETE FROM trusted_bank_senders
      WHERE id = ${id} AND tenant_id = ${tenant.id}
    `);

    reply.send({ success: true, message: 'Sender removed from whitelist.' });
  });

  // ---------------------------------------------------------------------------
  // 6. GET /v1/bank-feeds/gmail/status (Check background Gmail poller status)
  // ---------------------------------------------------------------------------
  fastify.get('/v1/bank-feeds/gmail/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = GmailBankAlertPoller.getStatus();
    reply.send({
      ...status,
      pubsubActive: true,
      pubsubWebhookPath: '/v1/bank-feeds/gmail/pubsub-webhook',
    });
  });

  // ---------------------------------------------------------------------------
  // 7. POST /v1/bank-feeds/gmail/sync-now (Trigger immediate manual Gmail check)
  // ---------------------------------------------------------------------------
  fastify.post('/v1/bank-feeds/gmail/sync-now', async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await GmailBankAlertPoller.pollOnce();
    reply.send(result);
  });

  // ---------------------------------------------------------------------------
  // 8. POST /v1/bank-feeds/gmail/pubsub-webhook (Google Cloud Pub/Sub Push Notification)
  // ---------------------------------------------------------------------------
  fastify.post('/v1/bank-feeds/gmail/pubsub-webhook', async (request: FastifyRequest<{ Body: unknown; Querystring: { token?: string; sync?: string } }>, reply: FastifyReply) => {
    // Optional Secret Token verification
    const expectedSecret = process.env.GMAIL_PUBSUB_SECRET?.trim();
    if (expectedSecret && expectedSecret.length > 0) {
      const queryToken = request.query?.token;
      const headerToken = request.headers['x-pubsub-token'] as string | undefined;
      if (queryToken !== expectedSecret && headerToken !== expectedSecret) {
        reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Invalid or missing Pub/Sub verification token.',
        });
        return;
      }
    }

    let decodedData: { emailAddress?: string; historyId?: string | number } = {};
    const body = (request.body || {}) as any;

    if (body.message && body.message.data) {
      try {
        const decodedStr = Buffer.from(body.message.data, 'base64').toString('utf-8');
        decodedData = JSON.parse(decodedStr);
        console.log(`[GmailPubSub] 🔔 Push notification received for ${decodedData.emailAddress || 'account'} (historyId: ${decodedData.historyId || 'n/a'})`);
      } catch (err: any) {
        console.warn('[GmailPubSub] Notice: Pub/Sub data was not JSON:', err.message);
      }
    } else {
      console.log('[GmailPubSub] Received Pub/Sub ping or empty payload.');
    }

    // Trigger instant fetch and verification of bank alert email
    const shouldWait = request.query?.sync !== 'false';
    const pollPromise = GmailBankAlertPoller.pollOnce();
    const pollResult = shouldWait ? await pollPromise : null;

    reply.status(200).send({
      success: true,
      message: 'Google Cloud Pub/Sub push notification processed successfully.',
      history_id: decodedData.historyId ?? null,
      sync_result: pollResult,
    });
  });
}
