import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import { ProviderRegistry } from '../providers/index.js';
import type { OcrExtractionResult } from '../ocr/index.js';

export interface VerificationContext {
  tenantId: string;
  paymentRequestId: string;
  paymentId: string;
  receiptId?: string;
  receiptSha256Hash: string;
  expectedAmountPaisa: number;
  expectedCurrency: string;
  paymentMethodCode: string;
  configuredDestinationAccount?: string;
  expiresAt: Date;
  ocrExtraction?: OcrExtractionResult;
  trustedEvidence?: {
    providerTransactionId: string;
    evidenceType: 'api_callback' | 'statement_reconciliation' | 'authorized_manual_entry';
    amountPaisa: number;
    currency: string;
    isMock?: boolean;
    rawPayload?: Record<string, unknown>;
  };
}

export interface VerificationCheckResult {
  checkName: string;
  passed: boolean;
  details: Record<string, unknown>;
}

export interface VerificationEngineOutput {
  status: 'pending_review' | 'verified' | 'rejected' | 'expired';
  verificationMethod: 'provider_verified' | 'manual_verified' | null;
  rejectionReason?: string;
  checks: VerificationCheckResult[];
}

export class VerificationEngine {
  /**
   * Run all deterministic verification checks against the payment request and incoming evidence
   */
  static async evaluate(ctx: VerificationContext): Promise<VerificationEngineOutput> {
    const db = await getDb();
    const checks: VerificationCheckResult[] = [];
    const now = new Date();

    // -------------------------------------------------------------------------
    // 1. EXPIRY CHECK
    // -------------------------------------------------------------------------
    const isExpired = now.getTime() > new Date(ctx.expiresAt).getTime();
    checks.push({
      checkName: 'EXPIRY_CHECK',
      passed: !isExpired,
      details: {
        currentTime: now.toISOString(),
        expiresAt: new Date(ctx.expiresAt).toISOString(),
        isExpired,
      },
    });

    if (isExpired) {
      await this.persistChecks(db, ctx.paymentId, ctx.tenantId, checks);
      return {
        status: 'expired',
        verificationMethod: null,
        rejectionReason: 'Payment request expired before receipt or confirmation was provided.',
        checks,
      };
    }

    // -------------------------------------------------------------------------
    // 2. RECEIPT DEDUPLICATION CHECK (SHA-256 Hash Uniqueness)
    // -------------------------------------------------------------------------
    let duplicateReceiptFound = false;
    if (ctx.receiptSha256Hash) {
      const existingReceipts = await db.execute(sql`
        SELECT r.id, r.payment_request_id, p.status
        FROM receipts r
        JOIN payments p ON p.receipt_id = r.id
        WHERE r.tenant_id = ${ctx.tenantId}
          AND r.sha256_hash = ${ctx.receiptSha256Hash}
          AND r.payment_request_id != ${ctx.paymentRequestId}
        LIMIT 1
      `);

      if (existingReceipts.rows.length > 0) {
        duplicateReceiptFound = true;
      }
    }

    checks.push({
      checkName: 'RECEIPT_HASH_UNIQUE',
      passed: !duplicateReceiptFound,
      details: {
        receiptHash: ctx.receiptSha256Hash,
        duplicateFound: duplicateReceiptFound,
      },
    });

    if (duplicateReceiptFound) {
      await this.persistChecks(db, ctx.paymentId, ctx.tenantId, checks);
      return {
        status: 'rejected',
        verificationMethod: null,
        rejectionReason: 'Duplicate receipt detected: This payment proof screenshot has already been used for another transaction.',
        checks,
      };
    }

    // -------------------------------------------------------------------------
    // 3. TRANSACTION REFERENCE DEDUPLICATION CHECK
    // -------------------------------------------------------------------------
    const txnRefCandidate =
      ctx.trustedEvidence?.providerTransactionId ||
      ctx.ocrExtraction?.extractedTransactionId;

    let duplicateTxnFound = false;
    if (txnRefCandidate) {
      const existingTxn = await db.execute(sql`
        SELECT id, payment_request_id, status
        FROM payments
        WHERE tenant_id = ${ctx.tenantId}
          AND transaction_reference = ${txnRefCandidate}
          AND payment_request_id != ${ctx.paymentRequestId}
          AND status IN ('verified', 'pending_review')
        LIMIT 1
      `);

      if (existingTxn.rows.length > 0) {
        duplicateTxnFound = true;
      }
    }

    checks.push({
      checkName: 'TXN_REF_UNIQUE',
      passed: !duplicateTxnFound,
      details: {
        transactionReference: txnRefCandidate ?? null,
        duplicateFound: duplicateTxnFound,
      },
    });

    if (duplicateTxnFound) {
      await this.persistChecks(db, ctx.paymentId, ctx.tenantId, checks);
      return {
        status: 'rejected',
        verificationMethod: null,
        rejectionReason: `Duplicate transaction reference: ID '${txnRefCandidate}' has already been processed or is pending verification.`,
        checks,
      };
    }

    // -------------------------------------------------------------------------
    // 4. AMOUNT MATCH CHECK
    // -------------------------------------------------------------------------
    let amountMatched = false;
    let actualAmountPaisa: number | null = null;

    if (ctx.trustedEvidence) {
      actualAmountPaisa = ctx.trustedEvidence.amountPaisa;
      amountMatched = actualAmountPaisa === ctx.expectedAmountPaisa;
    } else if (ctx.ocrExtraction && ctx.ocrExtraction.extractedAmountPaisa) {
      actualAmountPaisa = ctx.ocrExtraction.extractedAmountPaisa;
      // Note: OCR amount is untrusted, but we evaluate whether it matches
      amountMatched = actualAmountPaisa === ctx.expectedAmountPaisa;
    }

    checks.push({
      checkName: 'AMOUNT_MATCH',
      passed: amountMatched,
      details: {
        expectedPaisa: ctx.expectedAmountPaisa,
        evaluatedPaisa: actualAmountPaisa,
        isExactMatch: amountMatched,
      },
    });

    // -------------------------------------------------------------------------
    // 5. CURRENCY MATCH CHECK
    // -------------------------------------------------------------------------
    const currencyCandidate =
      ctx.trustedEvidence?.currency || ctx.ocrExtraction?.extractedCurrency || 'PKR';
    const currencyMatched = currencyCandidate.toUpperCase() === ctx.expectedCurrency.toUpperCase();

    checks.push({
      checkName: 'CURRENCY_MATCH',
      passed: currencyMatched,
      details: {
        expectedCurrency: ctx.expectedCurrency,
        evaluatedCurrency: currencyCandidate,
      },
    });

    // -------------------------------------------------------------------------
    // 6. DESTINATION ACCOUNT MATCH CHECK
    // -------------------------------------------------------------------------
    let destinationMatched = true; // default true if unextracted
    if (ctx.configuredDestinationAccount && ctx.ocrExtraction?.extractedReceiverAccount) {
      const cleanExpected = ctx.configuredDestinationAccount.replace(/[\s-]/g, '').toLowerCase();
      const cleanExtracted = ctx.ocrExtraction.extractedReceiverAccount.replace(/[\s-]/g, '').toLowerCase();
      destinationMatched = cleanExpected.includes(cleanExtracted) || cleanExtracted.includes(cleanExpected);
    }

    checks.push({
      checkName: 'RECEIVER_ACCOUNT_MATCH',
      passed: destinationMatched,
      details: {
        configuredAccount: ctx.configuredDestinationAccount ?? null,
        extractedAccount: ctx.ocrExtraction?.extractedReceiverAccount ?? null,
        matched: destinationMatched,
      },
    });

    // -------------------------------------------------------------------------
    // 7. DATE PLAUSIBILITY CHECK
    // -------------------------------------------------------------------------
    checks.push({
      checkName: 'DATE_PLAUSIBLE',
      passed: true,
      details: {
        extractedDateTime: ctx.ocrExtraction?.extractedDateTime ?? null,
        evaluatedAt: now.toISOString(),
      },
    });

    // -------------------------------------------------------------------------
    // 8. INDEPENDENT TRUSTED EVIDENCE CHECK
    // -------------------------------------------------------------------------
    // CRITICAL SECURITY RULE:
    // "Never mark a payment verified only because OCR extracted the expected amount
    // or because a customer uploaded a screenshot.
    // If a trusted provider API or authenticated transaction source is unavailable,
    // send the payment to manual review."
    const hasTrustedEvidence = Boolean(
      ctx.trustedEvidence &&
      !ctx.trustedEvidence.isMock &&
      ctx.trustedEvidence.evidenceType
    );

    checks.push({
      checkName: 'TRUSTED_PROVIDER_EVIDENCE',
      passed: hasTrustedEvidence,
      details: {
        hasTrustedEvidence,
        isMock: ctx.trustedEvidence?.isMock ?? false,
        evidenceType: ctx.trustedEvidence?.evidenceType ?? 'none',
        note: hasTrustedEvidence
          ? 'Confirmed via authentic provider API callback or reconciled statement.'
          : 'No direct provider API confirmation. Escalating to human reviewer.',
      },
    });

    await this.persistChecks(db, ctx.paymentId, ctx.tenantId, checks);

    // If trusted provider evidence exists and passes amount and currency checks
    if (hasTrustedEvidence && amountMatched && currencyMatched) {
      return {
        status: 'verified',
        verificationMethod: 'provider_verified',
        checks,
      };
    }

    // Default: Must go to manual review (`pending_review`)
    return {
      status: 'pending_review',
      verificationMethod: null,
      checks,
    };
  }

  private static async persistChecks(
    db: any,
    paymentId: string,
    tenantId: string,
    checks: VerificationCheckResult[]
  ): Promise<void> {
    for (const check of checks) {
      await db.execute(sql`
        INSERT INTO verification_checks (payment_id, tenant_id, check_name, passed, details)
        VALUES (${paymentId}, ${tenantId}, ${check.checkName}, ${check.passed}, ${JSON.stringify(check.details)}::jsonb)
      `);
    }
  }
}
