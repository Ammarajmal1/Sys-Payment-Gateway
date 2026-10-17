import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { generateWebhookSignature } from '../../utils/crypto.js';

export interface WebhookEventPayload {
  id: string;
  eventType: string;
  createdAt: string;
  paymentRequestId: string;
  orderReference: string;
  amountPaisa: number;
  currency: string;
  status: string;
  verificationMethod: string | null;
  data: Record<string, unknown>;
}

export class WebhookDispatcher {
  /**
   * Create and record a webhook event, then asynchronously trigger delivery
   */
  static async publishEvent(
    tenantId: string,
    eventType: string,
    paymentRequestId: string,
    orderReference: string,
    amountPaisa: number,
    currency: string,
    status: string,
    verificationMethod: string | null,
    extraData: Record<string, unknown> = {}
  ): Promise<string> {
    const db = await getDb();
    const eventId = crypto.randomUUID();
    const idempotencyKey = `evt_${eventType}_${paymentRequestId}_${Date.now()}`;

    const payload: WebhookEventPayload = {
      id: eventId,
      eventType,
      createdAt: new Date().toISOString(),
      paymentRequestId,
      orderReference,
      amountPaisa,
      currency,
      status,
      verificationMethod,
      data: extraData,
    };

    // Store in webhook_events table
    await db.execute(sql`
      INSERT INTO webhook_events (id, tenant_id, event_type, payload, idempotency_key)
      VALUES (${eventId}, ${tenantId}, ${eventType}, ${JSON.stringify(payload)}::jsonb, ${idempotencyKey})
    `);

    // Find active endpoints for this tenant
    const endpointsResult = await db.execute(sql`
      SELECT id, url, secret, events
      FROM webhook_endpoints
      WHERE tenant_id = ${tenantId} AND is_active = TRUE
    `);

    for (const ep of endpointsResult.rows) {
      const endpointId = ep.id as string;
      const url = ep.url as string;
      const secret = ep.secret as string;
      const subscribedEvents = (ep.events as string[]) || ['*'];

      // Check if endpoint is subscribed to this event
      const matches = subscribedEvents.includes('*') || subscribedEvents.includes(eventType);
      if (matches) {
        // Dispatch in background
        setImmediate(async () => {
          await this.dispatchToEndpoint(eventId, endpointId, tenantId, url, secret, payload, 1);
        });
      }
    }

    return eventId;
  }

  /**
   * Dispatch single delivery with HMAC-SHA256 signature and record outcome
   */
  static async dispatchToEndpoint(
    eventId: string,
    endpointId: string,
    tenantId: string,
    url: string,
    secret: string,
    payload: WebhookEventPayload,
    attemptNumber = 1
  ): Promise<{ success: boolean; httpStatus?: number; error?: string }> {
    const db = await getDb();
    const payloadString = JSON.stringify(payload);
    const { headerValue } = generateWebhookSignature(payloadString, secret);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'SysGalaxy-Webhook-Dispatcher/1.0',
      'X-SysGalaxy-Signature': headerValue,
      'X-SysGalaxy-Event': payload.eventType,
      'X-SysGalaxy-Delivery-Attempt': String(attemptNumber),
    };

    let httpStatusCode: number | undefined;
    let responseBody: string | undefined;
    let errorMessage: string | undefined;
    let deliveryStatus: 'pending' | 'success' | 'failed' | 'retrying' = 'pending';

    const timeoutMs = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '10000', 10);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: controller.signal,
      });

      httpStatusCode = response.status;
      responseBody = (await response.text()).slice(0, 4000);

      if (response.ok) {
        deliveryStatus = 'success';
      } else {
        deliveryStatus = attemptNumber < 3 ? 'retrying' : 'failed';
        errorMessage = `HTTP error status ${response.status}`;
      }
    } catch (err: any) {
      deliveryStatus = attemptNumber < 3 ? 'retrying' : 'failed';
      errorMessage = err.name === 'AbortError' ? 'Webhook delivery timed out' : err.message;
    } finally {
      clearTimeout(timeout);
    }

    const nextRetryAt =
      deliveryStatus === 'retrying'
        ? new Date(Date.now() + Math.pow(2, attemptNumber) * 1000)
        : null;

    // Log delivery attempt
    await db.execute(sql`
      INSERT INTO webhook_deliveries (
        webhook_event_id, webhook_endpoint_id, tenant_id, attempt_number,
        status, http_status_code, request_headers, request_body,
        response_body, error_message, next_retry_at
      ) VALUES (
        ${eventId}, ${endpointId}, ${tenantId}, ${attemptNumber},
        ${deliveryStatus}, ${httpStatusCode ?? null}, ${JSON.stringify(headers)}::jsonb, ${payloadString},
        ${responseBody ?? null}, ${errorMessage ?? null}, ${nextRetryAt ? nextRetryAt.toISOString() : null}
      )
    `);

    // Handle retry with exponential backoff if retrying
    if (deliveryStatus === 'retrying') {
      const delayMs = Math.pow(2, attemptNumber) * 1000;
      setTimeout(async () => {
        await this.dispatchToEndpoint(
          eventId,
          endpointId,
          tenantId,
          url,
          secret,
          payload,
          attemptNumber + 1
        );
      }, delayMs);
    }

    return {
      success: deliveryStatus === 'success',
      httpStatus: httpStatusCode,
      error: errorMessage,
    };
  }

  /**
   * Manual retry of an existing failed delivery from the dashboard
   */
  static async retryDelivery(deliveryId: string, tenantId: string): Promise<boolean> {
    const db = await getDb();
    const deliveryResult = await db.execute(sql`
      SELECT d.*, e.payload, ep.url, ep.secret
      FROM webhook_deliveries d
      JOIN webhook_events e ON e.id = d.webhook_event_id
      JOIN webhook_endpoints ep ON ep.id = d.webhook_endpoint_id
      WHERE d.id = ${deliveryId} AND d.tenant_id = ${tenantId}
      LIMIT 1
    `);

    if (deliveryResult.rows.length === 0) {
      throw new Error('Webhook delivery not found');
    }

    const row = deliveryResult.rows[0];
    const payload = row.payload as WebhookEventPayload;
    const res = await this.dispatchToEndpoint(
      row.webhook_event_id as string,
      row.webhook_endpoint_id as string,
      tenantId,
      row.url as string,
      row.secret as string,
      payload,
      (row.attempt_number as number) + 1
    );

    return res.success;
  }
}
