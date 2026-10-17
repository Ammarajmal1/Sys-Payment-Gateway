import crypto from 'node:crypto';
import { verifyWebhookSignature } from '../../src/utils/crypto.js';

export interface TailorOsSubscription {
  id: string;
  orderReference: string;
  customerEmail: string;
  planName: string;
  amountPaisa: number;
  currency: string;
  status: 'pending_payment' | 'active' | 'cancelled';
  activatedAt?: string;
  gatewayPaymentRequestId?: string;
}

export class TailorOsBillingService {
  private gatewayApiUrl: string;
  private gatewayApiKey: string;
  private webhookSecret: string;
  private subscriptions: Map<string, TailorOsSubscription> = new Map();
  private processedWebhookEvents: Set<string> = new Set();

  constructor(options: {
    gatewayApiUrl: string;
    gatewayApiKey: string;
    webhookSecret: string;
  }) {
    this.gatewayApiUrl = options.gatewayApiUrl.replace(/\/$/, '');
    this.gatewayApiKey = options.gatewayApiKey;
    this.webhookSecret = options.webhookSecret;
  }

  /**
   * Step 1: Tailor OS creates a payment request on SysGalaxy Gateway
   */
  async createSubscriptionPaymentRequest(orderReference: string, customerEmail: string, amountPaisa: number): Promise<{
    subscription: TailorOsSubscription;
    gatewayResponse: any;
  }> {
    // Record internal subscription in pending_payment state
    const subscription: TailorOsSubscription = {
      id: `sub_${crypto.randomBytes(6).toString('hex')}`,
      orderReference,
      customerEmail,
      planName: 'Tailor OS Professional Plan (1 Year)',
      amountPaisa,
      currency: 'PKR',
      status: 'pending_payment',
    };
    this.subscriptions.set(orderReference, subscription);

    // Call SysGalaxy Gateway API
    const response = await fetch(`${this.gatewayApiUrl}/v1/payment-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.gatewayApiKey}`,
        'Idempotency-Key': `tailor_idem_${orderReference}`,
      },
      body: JSON.stringify({
        order_reference: orderReference,
        amount_paisa: amountPaisa,
        currency: 'PKR',
        payment_method_code: 'jazzcash',
        customer_email: customerEmail,
        customer_name: 'Master Tailor Shop',
        expires_in_minutes: 120,
        metadata: {
          software: 'Tailor OS',
          module: 'subscription_renewal',
          subscription_id: subscription.id,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gateway returned error ${response.status}: ${err}`);
    }

    const gatewayResponse = (await response.json()) as any;
    subscription.gatewayPaymentRequestId = gatewayResponse.id;

    return { subscription, gatewayResponse };
  }

  /**
   * Step 5 & 6: Tailor OS webhook receiver
   * Verifies signature, validates amount and status, and activates subscription idempotently
   */
  async handleGatewayWebhook(
    signatureHeader: string,
    rawPayload: string
  ): Promise<{ handled: boolean; actionTaken: string; error?: string }> {
    // 1. Verify HMAC-SHA256 signature
    const sigCheck = verifyWebhookSignature(signatureHeader, rawPayload, this.webhookSecret);
    if (!sigCheck.isValid) {
      return { handled: false, actionTaken: 'rejected_unauthorized', error: sigCheck.error };
    }

    const event = JSON.parse(rawPayload);

    // 2. Duplicate event / Idempotency protection
    if (this.processedWebhookEvents.has(event.id)) {
      return { handled: true, actionTaken: 'duplicate_ignored' };
    }

    const orderReference = event.orderReference;
    const subscription = this.subscriptions.get(orderReference);

    if (!subscription) {
      return { handled: false, actionTaken: 'order_not_found', error: `Unknown order: ${orderReference}` };
    }

    // 3. Verify amount and currency match expected values
    if (event.amountPaisa !== subscription.amountPaisa || event.currency !== subscription.currency) {
      return {
        handled: false,
        actionTaken: 'amount_mismatch_rejected',
        error: `Expected ${subscription.amountPaisa} ${subscription.currency}, got ${event.amountPaisa} ${event.currency}`,
      };
    }

    // 4. CRITICAL RULE: DO NOT activate while status is pending_review
    if (event.status === 'pending_review') {
      this.processedWebhookEvents.add(event.id);
      return {
        handled: true,
        actionTaken: 'awaiting_merchant_approval',
      };
    }

    // 5. Activate subscription ONLY when payment is verified
    if (event.status === 'verified') {
      subscription.status = 'active';
      subscription.activatedAt = new Date().toISOString();
      this.processedWebhookEvents.add(event.id);
      return {
        handled: true,
        actionTaken: 'subscription_activated',
      };
    }

    // Handle rejection or expiration
    if (event.status === 'rejected' || event.status === 'expired') {
      subscription.status = 'cancelled';
      this.processedWebhookEvents.add(event.id);
      return {
        handled: true,
        actionTaken: `marked_${event.status}`,
      };
    }

    return { handled: true, actionTaken: 'unhandled_event_type' };
  }

  getSubscription(orderReference: string): TailorOsSubscription | undefined {
    return this.subscriptions.get(orderReference);
  }
}
