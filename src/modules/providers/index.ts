export interface ProviderVerificationResult {
  verified: boolean;
  evidenceType: 'api_callback' | 'statement_reconciliation' | 'authorized_manual_entry' | 'none';
  providerTransactionId?: string;
  isMock: boolean;
  details: Record<string, unknown>;
}

export interface PaymentProviderAdapter {
  readonly providerCode: string;
  readonly name: string;
  isOfficialConfigured(): boolean;
  verifyEvidence(
    transactionReference: string,
    expectedAmountPaisa: number,
    currency: string
  ): Promise<ProviderVerificationResult>;
}

/**
 * Easypaisa Payment Provider Adapter
 * Awaiting official Telenor Microfinance Bank API credentials and OpenAPI spec.
 */
export class EasypaisaAdapter implements PaymentProviderAdapter {
  readonly providerCode = 'easypaisa';
  readonly name = 'Easypaisa (Telenor Bank)';

  isOfficialConfigured(): boolean {
    return Boolean(process.env.EASYPAISA_MERCHANT_ID && process.env.EASYPAISA_API_SECRET);
  }

  async verifyEvidence(
    transactionReference: string,
    expectedAmountPaisa: number,
    currency: string
  ): Promise<ProviderVerificationResult> {
    if (!this.isOfficialConfigured()) {
      return {
        verified: false,
        evidenceType: 'none',
        isMock: false,
        details: {
          status: 'awaiting_official_credentials',
          message: 'Official Easypaisa merchant API credentials not configured. Payment sent to manual review queue.',
        },
      };
    }

    // When official credentials are provided in production, real mPOS/IPN verification happens here
    return {
      verified: false,
      evidenceType: 'none',
      isMock: false,
      details: { message: 'Provider API integration pending credential activation.' },
    };
  }
}

/**
 * JazzCash Payment Provider Adapter
 * Awaiting official Mobilink Microfinance Bank merchant credentials.
 */
export class JazzCashAdapter implements PaymentProviderAdapter {
  readonly providerCode = 'jazzcash';
  readonly name = 'JazzCash (Mobilink Bank)';

  isOfficialConfigured(): boolean {
    return Boolean(process.env.JAZZCASH_MERCHANT_ID && process.env.JAZZCASH_API_SECRET);
  }

  async verifyEvidence(
    transactionReference: string,
    expectedAmountPaisa: number,
    currency: string
  ): Promise<ProviderVerificationResult> {
    if (!this.isOfficialConfigured()) {
      return {
        verified: false,
        evidenceType: 'none',
        isMock: false,
        details: {
          status: 'awaiting_official_credentials',
          message: 'Official JazzCash merchant API credentials not configured. Payment sent to manual review queue.',
        },
      };
    }

    return {
      verified: false,
      evidenceType: 'none',
      isMock: false,
      details: { message: 'Provider API integration pending credential activation.' },
    };
  }
}

/**
 * Direct Bank Transfer / 1Link Provider Adapter
 * Awaiting official 1Link Member Bank Host-to-Host / Raast reconciliation API.
 */
export class BankTransferAdapter implements PaymentProviderAdapter {
  readonly providerCode = 'bank_transfer';
  readonly name = 'Direct Bank Transfer (1Link / Raast)';

  isOfficialConfigured(): boolean {
    return Boolean(process.env.BANK_RECONCILIATION_API_KEY);
  }

  async verifyEvidence(
    transactionReference: string,
    expectedAmountPaisa: number,
    currency: string
  ): Promise<ProviderVerificationResult> {
    return {
      verified: false,
      evidenceType: 'none',
      isMock: false,
      details: {
        status: 'awaiting_bank_api',
        message: '1Link / Raast Host-to-Host statement API not configured. Bank transfer requires authorized reviewer reconciliation.',
      },
    };
  }
}

/**
 * Synthetic Mock Adapter (Strictly for unit/integration test harness)
 * Explicitly flags `isMock: true` and is never treated as genuine production verification.
 */
export class MockTestProviderAdapter implements PaymentProviderAdapter {
  readonly providerCode = 'mock_test_provider';
  readonly name = 'Mock Test Adapter (Unit Tests Only)';

  isOfficialConfigured(): boolean {
    return true;
  }

  async verifyEvidence(
    transactionReference: string,
    expectedAmountPaisa: number,
    currency: string
  ): Promise<ProviderVerificationResult> {
    return {
      verified: true,
      evidenceType: 'api_callback',
      providerTransactionId: `MOCK-${transactionReference}`,
      isMock: true,
      details: {
        warning: 'SYNTHETIC TEST EVIDENCE ONLY. NEVER USE IN PRODUCTION WORKFLOWS.',
      },
    };
  }
}

export class ProviderRegistry {
  private static adapters: Map<string, PaymentProviderAdapter> = new Map<string, PaymentProviderAdapter>([
    ['easypaisa', new EasypaisaAdapter()],
    ['jazzcash', new JazzCashAdapter()],
    ['bank_transfer', new BankTransferAdapter()],
    ['mock_test_provider', new MockTestProviderAdapter()],
  ]);

  static get(providerCode: string): PaymentProviderAdapter | undefined {
    return this.adapters.get(providerCode.toLowerCase());
  }

  static register(adapter: PaymentProviderAdapter): void {
    this.adapters.set(adapter.providerCode.toLowerCase(), adapter);
  }
}
