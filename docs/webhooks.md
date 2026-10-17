# SysGalaxy Payment Verification Gateway — Webhooks Reference

Webhooks allow your application to receive real-time, asynchronous notifications when a payment request changes status or when a customer uploads a receipt.

---

## 1. Webhook Events List

| Event Type | Trigger Condition |
| :--- | :--- |
| `payment.created` | Emitted immediately when a new payment request is created. |
| `receipt.uploaded` | Emitted when a customer successfully uploads a payment slip screenshot. |
| `payment.pending_review` | Emitted when OCR completes and the payment enters the compliance review queue. |
| `payment.verified` | Emitted when funds are verified (via direct provider API or manual compliance approval). |
| `payment.rejected` | Emitted when a transaction is rejected (e.g. duplicate slip, wrong amount, fraud). |
| `payment.expired` | Emitted when a payment request reaches its expiration deadline without receipt. |

---

## 2. Event Payload Schema

Every webhook event delivered by SysGalaxy contains a standard JSON structure:

```json
{
  "id": "7f9a2e8c-1b4d-4f5a-8b7c-9e0f1a2b3c4d",
  "eventType": "payment.verified",
  "createdAt": "2026-10-17T01:40:00.000Z",
  "paymentRequestId": "e4a2c5a0-97e3-4f93-b684-2195f0012bce",
  "orderReference": "TAILOR_SUB_4492",
  "amountPaisa": 125000,
  "currency": "PKR",
  "status": "verified",
  "verificationMethod": "manual_verified",
  "data": {
    "evidence_reference": "Meezan Corporate NetBanking Entry #88229",
    "reviewed_by": "Authorized Compliance Officer"
  }
}
```

---

## 3. Signature Verification & Headers

SysGalaxy delivers webhooks with the following HTTP headers:

| Header | Description |
| :--- | :--- |
| `Content-Type` | `application/json` |
| `X-SysGalaxy-Signature` | Signature header: `t=<timestamp>,v1=<hmac_sha256_hex>` |
| `X-SysGalaxy-Event` | The event type string (e.g. `payment.verified`) |
| `X-SysGalaxy-Delivery-Attempt` | Integer delivery attempt count (e.g. `1`, `2`) |
| `User-Agent` | `SysGalaxy-Webhook-Dispatcher/1.0` |

### Verification Formula
$$\text{Expected Signature} = \text{crypto.createHmac}('sha256', secret).\text{update}(t + '.' + rawPayload).\text{digest}('hex')$$

---

## 4. Multi-Language Verification Examples

### Node.js (Express / Fastify)
```typescript
import crypto from 'node:crypto';

export function verifyWebhook(signatureHeader: string, rawBody: string, secret: string): boolean {
  const parts = Object.fromEntries(signatureHeader.split(',').map(p => p.split('=')));
  const timestamp = parseInt(parts.t, 10);
  const signature = parts.v1;

  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
    return false; // Replay attack protection (5 min window)
  }

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}
```

### Python (FastAPI / Flask)
```python
import hmac
import hashlib
import time

def verify_webhook(signature_header: str, raw_body: bytes, secret: str) -> bool:
    parts = dict(x.split("=") for x in signature_header.split(","))
    timestamp = int(parts["t"])
    signature = parts["v1"]

    if abs(time.time() - timestamp) > 300:
        return False

    payload = f"{timestamp}.".encode("utf-8") + raw_body
    expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)
```

---

## 5. Retry Policy & Delivery Logs

If your destination server returns an HTTP error code (`5xx`, `4xx`) or times out (10s limit):
1. **Exponential Backoff**: SysGalaxy retries up to 3 times automatically:
   - Attempt 1: Immediate
   - Attempt 2: After 2 seconds
   - Attempt 3: After 4 seconds
2. **Delivery Logs**: Full logs of the request body, response code, and error messages are saved in the `webhook_deliveries` table.
3. **Manual Retry**: Merchants can re-dispatch failed deliveries from the Admin Dashboard or via:
   `POST /v1/webhooks/deliveries/:id/retry`
