import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import { parseReceiptText } from '../ocr/index.js';
import { AuditLogger } from '../audit/index.js';
import { WebhookDispatcher } from '../webhooks/dispatcher.js';

import dotenv from 'dotenv';

export interface GmailPollerStatus {
  enabled: boolean;
  configured: boolean;
  gmailUser: string | null;
  isRunning: boolean;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  processedCount: number;
  verifiedCount: number;
}

export class GmailBankAlertPoller {
  private static isRunning = false;
  private static pollTimer: NodeJS.Timeout | null = null;
  private static lastPollAt: string | null = null;
  private static lastSuccessAt: string | null = null;
  private static lastError: string | null = null;
  private static processedCount = 0;
  private static verifiedCount = 0;

  /**
   * Return current poller health & diagnostic status
   */
  public static getStatus(): GmailPollerStatus {
    dotenv.config();
    const user = process.env.GMAIL_USER || null;
    const pass = process.env.GMAIL_APP_PASSWORD || null;
    const enabled = process.env.GMAIL_ENABLED !== 'false';
    const configured = Boolean(user && pass && pass.trim().length > 0 && pass !== 'your_16_digit_app_password');

    let maskedUser: string | null = null;
    if (user && user.includes('@')) {
      const [localPart, domain] = user.split('@');
      const visibleChars = Math.min(3, localPart.length);
      maskedUser = `${localPart.substring(0, visibleChars)}***@${domain}`;
    }

    return {
      enabled,
      configured,
      gmailUser: maskedUser,
      isRunning: this.isRunning,
      lastPollAt: this.lastPollAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      processedCount: this.processedCount,
      verifiedCount: this.verifiedCount,
    };
  }

  /**
   * Start recurring polling loop if enabled
   */
  public static start(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    const intervalMs = parseInt(process.env.GMAIL_POLL_INTERVAL_MS || '30000', 10);
    const enabled = process.env.GMAIL_ENABLED !== 'false';

    if (!enabled) {
      console.log('[GmailPoller] Gmail Bank Alert Poller is disabled via GMAIL_ENABLED=false.');
      return;
    }

    console.log(`[GmailPoller] Starting background bank email poller (every ${intervalMs / 1000}s)...`);

    // Initial check after 5 seconds
    setTimeout(() => {
      this.pollOnce().catch((err) => {
        console.warn('[GmailPoller] Initial poll check error:', err.message);
      });
    }, 5000);

    // Recurring poll
    this.pollTimer = setInterval(() => {
      this.pollOnce().catch((err) => {
        console.warn('[GmailPoller] Recurring poll error:', err.message);
      });
    }, Math.max(intervalMs, 10000));
  }

  /**
   * Stop recurring polling loop
   */
  public static stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isRunning = false;
    console.log('[GmailPoller] Poller stopped.');
  }

  /**
   * Execute a single check of unseen bank alert emails
   */
  public static async pollOnce(): Promise<{
    status: 'success' | 'skipped' | 'error';
    message: string;
    processed: number;
    verified: number;
  }> {
    dotenv.config();
    const user = process.env.GMAIL_USER?.trim();
    const pass = process.env.GMAIL_APP_PASSWORD?.trim();

    if (!user || !pass || pass === 'your_16_digit_app_password' || pass.length < 4) {
      this.lastError = 'Gmail credentials not configured in .env (GMAIL_APP_PASSWORD required).';
      return {
        status: 'skipped',
        message: 'Gmail credentials not configured. Please add your 16-character Google App Password to .env.',
        processed: 0,
        verified: 0,
      };
    }

    if (this.isRunning) {
      return {
        status: 'skipped',
        message: 'A Gmail poll cycle is already running.',
        processed: 0,
        verified: 0,
      };
    }

    this.isRunning = true;
    this.lastPollAt = new Date().toISOString();

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user,
        pass: pass.replace(/\s+/g, ''), // Google app passwords can have spaces
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      logger: false,
    });

    // Handle idle socket drops and ECONNRESET events safely without crashing Node
    client.on('error', (err: any) => {
      console.warn('[GmailPoller] IMAP socket notice (recovered):', err?.message || err);
    });

    let cycleProcessed = 0;
    let cycleVerified = 0;

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        const db = await getDb();

        // 1. Fetch active trusted bank senders from database across all active tenants
        const trustedSendersRes = await db.execute(sql`
          SELECT tenant_id, sender_email, provider_code, sender_name
          FROM trusted_bank_senders
          WHERE is_active = TRUE
        `);

        const trustedRows = trustedSendersRes.rows as Array<{
          tenant_id: string;
          sender_email: string;
          provider_code: string;
          sender_name: string;
        }>;

        // 2. Search for UNSEEN messages
        const searchResult = await client.search({ seen: false }, { uid: true });
        const unseenUids = Array.isArray(searchResult) ? searchResult : [];

        if (unseenUids.length === 0) {
          this.lastSuccessAt = new Date().toISOString();
          this.lastError = null;
          return {
            status: 'success',
            message: 'No new unseen emails in INBOX.',
            processed: 0,
            verified: 0,
          };
        }

        // 3. Process each unseen message
        for (const uid of unseenUids) {
          try {
            const message = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
            if (!message || !message.source) continue;

            const parsed = await simpleParser(message.source);
            const fromAddress = parsed.from?.value?.[0]?.address?.toLowerCase().trim();

            if (!fromAddress) {
              // Mark as seen so we don't re-parse invalid headers
              await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
              continue;
            }

            // 4. Verify sender against Whitelist
            const matchingTenantConfigs = trustedRows.filter((row) => {
              const allowed = row.sender_email.toLowerCase().trim();
              if (allowed === fromAddress) return true;
              if (allowed.startsWith('@') && fromAddress.endsWith(allowed)) return true;
              const domain = fromAddress.split('@')[1];
              if (domain && (allowed === domain || allowed === `@${domain}`)) return true;
              return false;
            });

            if (matchingTenantConfigs.length === 0) {
              // Sender is not in the trusted bank senders list: ignore and skip!
              // (Leave unread or mark seen if purely junk, but we don't touch customer's personal mail)
              continue;
            }

            // Target tenant config
            const tenantConfig = matchingTenantConfigs[0];
            const tenantId = tenantConfig.tenant_id;
            const emailBody = parsed.text || parsed.html || '';

            // 5. Parse Transaction ID and Amount
            const extracted = parseReceiptText(emailBody, 99);
            const transactionId = extracted.extractedTransactionId;
            const amountPaisa = extracted.extractedAmountPaisa;
            const detectedProvider = extracted.detectedProvider || tenantConfig.provider_code;

            if (!transactionId || !amountPaisa) {
              // Whitelisted bank email received, but couldn't parse transaction fields yet
              await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
              continue;
            }

            cycleProcessed++;
            this.processedCount++;

            // 6. Record trusted evidence in database
            const evidenceId = crypto.randomUUID();
            await db.execute(sql`
              INSERT INTO trusted_payment_evidence (
                id, tenant_id, provider_code, provider_transaction_id,
                evidence_type, amount_paisa, currency, raw_payload, is_mock
              ) VALUES (
                ${evidenceId}, ${tenantId}, ${detectedProvider}, ${transactionId},
                'statement_reconciliation', ${amountPaisa}, 'PKR',
                ${JSON.stringify({
                  sender_email: fromAddress,
                  subject: parsed.subject,
                  date: parsed.date?.toISOString(),
                  message_id: parsed.messageId,
                })}::jsonb,
                FALSE
              )
            `);

            // 7. Check for matching pending payment
            const pendingMatches = await db.execute(sql`
              SELECT
                p.id as payment_id,
                p.payment_request_id,
                p.amount_paisa,
                p.currency,
                pr.order_reference
              FROM payments p
              JOIN payment_requests pr ON pr.id = p.payment_request_id
              WHERE p.tenant_id = ${tenantId}
                AND p.transaction_reference = ${transactionId}
                AND p.amount_paisa = ${amountPaisa}
                AND p.status IN ('pending_review', 'processing')
              LIMIT 1
            `);

            if (pendingMatches.rows.length > 0) {
              const matched = pendingMatches.rows[0];
              const paymentId = matched.payment_id as string;
              const orderRef = matched.order_reference as string;

              // Auto-verify payment
              await db.execute(sql`
                UPDATE payments
                SET status = 'verified',
                    verification_method = 'provider_verified',
                    verified_at = NOW(),
                    updated_at = NOW()
                WHERE id = ${paymentId}
              `);

              await db.execute(sql`
                UPDATE payment_requests
                SET status = 'verified',
                    verification_method = 'provider_verified',
                    updated_at = NOW()
                WHERE id = ${matched.payment_request_id}
              `);

              await db.execute(sql`
                UPDATE trusted_payment_evidence
                SET payment_id = ${paymentId}
                WHERE id = ${evidenceId}
              `);

              // Log audit trail
              await AuditLogger.log({
                tenantId,
                actorType: 'system',
                actorId: 'gmail_imap_poller',
                action: 'payment.auto_verified_via_gmail',
                entityType: 'payment',
                entityId: paymentId,
                metadata: {
                  sender_email: fromAddress,
                  transaction_id: transactionId,
                  amount_paisa: amountPaisa,
                  order_reference: orderRef,
                },
              });

              // Dispatch webhook to TailorShop TPMS / calling product
              await WebhookDispatcher.publishEvent(
                tenantId,
                'payment.verified',
                matched.payment_request_id as string,
                orderRef,
                Number(matched.amount_paisa),
                matched.currency as string,
                'verified',
                'provider_verified',
                {
                  transaction_reference: transactionId,
                  evidence_type: 'gmail_bank_alert_reconciliation',
                  sender_email: fromAddress,
                  verified_at: new Date().toISOString(),
                }
              );

              cycleVerified++;
              this.verifiedCount++;
              console.log(`[GmailPoller] 🎉 Auto-verified Order '${orderRef}' with TRX ${transactionId} (PKR ${amountPaisa / 100})!`);
            }

            // Mark processed bank alert as seen
            await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
          } catch (itemErr: any) {
            console.warn(`[GmailPoller] Error processing UID ${uid}:`, itemErr.message);
          }
        }

        this.lastSuccessAt = new Date().toISOString();
        this.lastError = null;

        return {
          status: 'success',
          message: `Gmail sync completed. ${cycleProcessed} bank emails processed, ${cycleVerified} payments automatically verified.`,
          processed: cycleProcessed,
          verified: cycleVerified,
        };
      } finally {
        lock.release();
      }
    } catch (err: any) {
      const detailedError = err.responseText || err.message;
      this.lastError = detailedError;
      console.warn('[GmailPoller] IMAP Connection / Sync Error:', detailedError);
      return {
        status: 'error',
        message: `IMAP connection error: ${detailedError}`,
        processed: cycleProcessed,
        verified: cycleVerified,
      };
    } finally {
      this.isRunning = false;
      try {
        await client.logout();
      } catch {
        // ignore logout error
      }
    }
  }
}
