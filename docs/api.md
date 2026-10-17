# SysGalaxy Payment Verification Gateway — API Reference Manual

Welcome to the **SysGalaxy Payment Verification Gateway API Reference**. SysGalaxy is an API-first, multi-tenant payment gateway enabling seamless payment verification for Pakistani wallets (Easypaisa, JazzCash) and 1Link Bank Transfers.

---

## 1. Base URL & Versioning

All API requests are versioned and served under the `/v1` prefix:

- **Local Development**: `http://localhost:3000/v1`
- **Production Base URL**: `https://api.sysgalaxy.io/v1`

---

## 2. Authentication & API Keys

Every API request to private endpoints must include an authenticated API Key belonging to your merchant tenant account.

### Authentication Headers
You can provide your key using either of the following headers:

```http
Authorization: Bearer sg_test_7f9a2e8c1b4d3f5a6b7c8d9e0f1a2b3c
```
or
```http
X-API-Key: sg_test_7f9a2e8c1b4d3f5a6b7c8d9e0f1a2b3c
```

### Key Environments
- **Sandbox Keys**: Prefixed with `sg_test_`. Use for test integrations without moving real money.
- **Production Keys**: Prefixed with `sg_live_`. Only generated in live production environments.

> **Security Rule**: API keys are hashed with SHA-256 upon generation. SysGalaxy only stores the hash; full keys are shown once and cannot be retrieved again. Never commit secret keys to client-side code or public repositories.

---

## 3. Monetary Representation: Integer Paisa

To prevent IEEE 754 floating-point rounding errors in financial transactions, all internal currency amounts in SysGalaxy are represented as **64-bit integer paisa**:

$$\text{Paisa} = \text{Amount in PKR} \times 100$$

- **PKR 1,250.00** = `125000` paisa
- **PKR 50.00** = `5000` paisa
- **PKR 10,000.50** = `1000050` paisa

When creating payment requests, you may pass either:
- `amount_paisa`: Integer paisa (recommended), or
- `amount`: Number in PKR (automatically rounded and converted to paisa).

---

## 4. Idempotency Support

To safely retry requests without accidentally creating duplicate payment requests, pass an `Idempotency-Key` header with any unique string (such as a UUID or internal order ID):

```http
Idempotency-Key: tailor_sub_order_9921_init
```

If SysGalaxy receives a request with an existing idempotency key for your tenant within a 24-hour window, it returns the cached HTTP status and body with the header:
```http
X-Cache-Lookup: IDEMPOTENT_HIT
```

---

## 5. Endpoints Reference

### 5.1 Payment Requests

#### `POST /v1/payment-requests`
Initiate a payment request and obtain payment instructions.

**Headers**:
- `Authorization: Bearer <API_KEY>`
- `Content-Type: application/json`
- `Idempotency-Key: <OPTIONAL_KEY>`

**Request Body**:
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `order_reference` | string | **Yes** | Your internal order, invoice, or subscription ID. |
| `amount_paisa` | integer | **Yes\*** | Amount in integer paisa (e.g. `125000` for PKR 1,250.00). |
| `amount` | number | **Yes\*** | Alternative: Amount in PKR (e.g. `1250.00`). |
| `currency` | string | No | Currency code. Default: `"PKR"`. |
| `payment_method_code` | string | **Yes** | Configured method: `"easypaisa"`, `"jazzcash"`, or `"bank_transfer"`. |
| `customer_reference` | string | No | Merchant's customer identifier. |
| `customer_name` | string | No | Name of the customer. |
| `customer_email` | string | No | Email address for receipt notifications. |
| `customer_phone` | string | No | Customer mobile number. |
| `expires_in_minutes` | integer | No | Validity duration (5 to 10080 minutes). Default: `60`. |
| `metadata` | object | No | Arbitrary JSON metadata returned in webhooks. |

*\* Either `amount_paisa` or `amount` must be provided.*

**Example Request**:
```json
{
  "order_reference": "TAILOR_SUB_4492",
  "amount_paisa": 125000,
  "currency": "PKR",
  "payment_method_code": "jazzcash",
  "customer_name": "Hamza Tariq",
  "customer_email": "hamza@example.com",
  "customer_phone": "03001234567",
  "expires_in_minutes": 120,
  "metadata": {
    "software": "Tailor OS",
    "plan": "Professional Annual"
  }
}
```

**Example Response (201 Created)**:
```json
{
  "id": "e4a2c5a0-97e3-4f93-b684-2195f0012bce",
  "reference": "pr_test_7f9a2e8c1b4d3f5a",
  "order_reference": "TAILOR_SUB_4492",
  "amount_paisa": 125000,
  "currency": "PKR",
  "status": "awaiting_payment",
  "verification_method": null,
  "expires_at": "2026-10-17T03:30:00.000Z",
  "instructions": {
    "payment_method": "JazzCash Account",
    "payment_method_code": "jazzcash",
    "account_title": "Tailor OS Payments",
    "account_identifier": "03000000000",
    "bank_name": null,
    "amount_paisa": 125000,
    "amount_formatted": "PKR 1,250.00",
    "gateway_reference": "pr_test_7f9a2e8c1b4d3f5a",
    "order_reference": "TAILOR_SUB_4492",
    "step_by_step": "Transfer via JazzCash mobile app to account 03000000000. Keep the transaction SMS and screenshot.",
    "expires_at": "2026-10-17T03:30:00.000Z",
    "upload_receipt_endpoint": "/v1/payment-requests/e4a2c5a0-97e3-4f93-b684-2195f0012bce/receipt"
  },
  "created_at": "2026-10-17T01:30:00.000Z"
}
```

---

#### `GET /v1/payment-requests/:id`
Retrieve details of a specific payment request by ID.

**Example Response (200 OK)**:
```json
{
  "id": "e4a2c5a0-97e3-4f93-b684-2195f0012bce",
  "reference": "pr_test_7f9a2e8c1b4d3f5a",
  "order_reference": "TAILOR_SUB_4492",
  "amount_paisa": 125000,
  "amount_formatted": "PKR 1,250.00",
  "currency": "PKR",
  "payment_method_code": "jazzcash",
  "status": "pending_review",
  "verification_method": null,
  "transaction_reference": "030099881122",
  "rejection_reason": null,
  "expires_at": "2026-10-17T03:30:00.000Z",
  "created_at": "2026-10-17T01:30:00.000Z",
  "instructions": {
    "payment_method": "JazzCash Account",
    "account_title": "Tailor OS Payments",
    "account_identifier": "03000000000",
    "bank_name": null,
    "step_by_step": "Transfer via JazzCash mobile app..."
  }
}
```

---

#### `GET /v1/payment-requests`
List all payment requests for the authenticated tenant with pagination.

**Query Parameters**:
- `status` (string, optional): Filter by status (`awaiting_payment`, `processing`, `pending_review`, `verified`, `rejected`, `expired`, `cancelled`).
- `order_reference` (string, optional): Search by merchant order reference.
- `limit` (integer, default `20`, max `100`): Results per page.
- `offset` (integer, default `0`): Pagination offset.

---

#### `POST /v1/payment-requests/:id/cancel`
Cancel an active payment request before it is verified.

---

### 5.2 Receipt Upload & Verification

#### `POST /v1/payment-requests/:id/receipt`
Upload customer payment screenshot/proof for deterministic verification and OCR analysis.

**Headers**:
- `Authorization: Bearer <API_KEY>`
- `Content-Type: multipart/form-data`

**Form Data**:
- `file`: The image or PDF file (allowed: PNG, JPEG, WebP, PDF; maximum 10MB).

**Verification Rules Applied**:
1. Magic bytes signature validation.
2. SHA-256 hash duplication check (rejects already-used receipts).
3. Transaction reference deduplication (rejects duplicate TIDs).
4. Local Tesseract.js OCR extraction of amount, TID, sender, receiver.
5. Independent trusted evidence evaluation.
   > **Critical Rule**: If authentic provider API confirmation is absent, payment transitions to `pending_review` for human review. It is **never** automatically verified on OCR alone.

**Example Response (200 OK)**:
```json
{
  "payment_request_id": "e4a2c5a0-97e3-4f93-b684-2195f0012bce",
  "payment_id": "9bf2639a-7a52-47ef-8d19-94b998e154f9",
  "receipt_id": "31b14a97-9e63-4cb7-a5ec-95d436cf4042",
  "status": "pending_review",
  "verification_method": null,
  "rejection_reason": null,
  "ocr": {
    "status": "completed",
    "confidence": 88.5,
    "detected_provider": "jazzcash",
    "extracted_amount_paisa": 125000,
    "extracted_transaction_id": "030099881122",
    "extracted_date_time": "16/10/2026 15:42",
    "untrusted_notice": "OCR output is unauthenticated customer data and is not treated as payment confirmation."
  },
  "checks": [
    { "checkName": "EXPIRY_CHECK", "passed": true, "details": { "isExpired": false } },
    { "checkName": "RECEIPT_HASH_UNIQUE", "passed": true, "details": { "duplicateFound": false } },
    { "checkName": "TXN_REF_UNIQUE", "passed": true, "details": { "duplicateFound": false } },
    { "checkName": "AMOUNT_MATCH", "passed": true, "details": { "expectedPaisa": 125000, "isExactMatch": true } },
    { "checkName": "CURRENCY_MATCH", "passed": true, "details": { "expectedCurrency": "PKR" } },
    { "checkName": "TRUSTED_PROVIDER_EVIDENCE", "passed": false, "details": { "hasTrustedEvidence": false, "note": "No direct provider API confirmation. Escalating to human reviewer." } }
  ],
  "message": "Receipt accepted. Direct automated bank confirmation is unavailable. Sent to merchant manual review queue."
}
```

---

#### `GET /v1/payment-requests/:id/verification`
Retrieve the complete verification audit breakdown, receipt SHA-256 hash, and check logs.

---

### 5.3 Payments & Manual Review

#### `GET /v1/payments`
List all payments with filtering by `status` and `verification_method`.

#### `GET /v1/payments/:id`
Retrieve detailed payment record including customer metadata, receipt details, OCR output, and verification history.

#### `POST /v1/payments/:id/review/approve`
Manually approve a payment in `pending_review` status with an audit trail.

**Request Body**:
```json
{
  "evidence_reference": "Meezan Bank Portal Ref #889922",
  "notes": "Verified credit in Meezan online corporate banking statement at 16:15.",
  "reviewer_name": "Compliance Officer"
}
```

**Response (200 OK)**:
```json
{
  "id": "9bf2639a-7a52-47ef-8d19-94b998e154f9",
  "status": "verified",
  "verification_method": "manual_verified",
  "verified_at": "2026-10-17T01:45:00.000Z",
  "reviewed_by": "Compliance Officer",
  "evidence_reference": "Meezan Bank Portal Ref #889922",
  "message": "Payment successfully approved through authorized manual review."
}
```

---

#### `POST /v1/payments/:id/review/reject`
Reject a payment in `pending_review` status.

**Request Body**:
```json
{
  "reason": "Payment slip appears edited. Funds not received in merchant account.",
  "reviewer_name": "Compliance Officer"
}
```

---

### 5.4 API Keys Management

- `GET /v1/api-keys`: List active & revoked API keys for the tenant.
- `POST /v1/api-keys`: Create a new API key.
- `POST /v1/api-keys/:id/revoke`: Revoke an existing API key.
- `POST /v1/api-keys/:id/rotate`: Revoke old key and issue replacement.

---

### 5.5 Payment Methods Configuration

- `GET /v1/payment-methods`: List tenant configured methods.
- `POST /v1/payment-methods`: Add or upsert a payment method.
- `PUT /v1/payment-methods/:id`: Update account titles, account identifiers, instructions, and limits.

---

### 5.6 Webhook Endpoints & Deliveries

- `GET /v1/webhooks`: List registered webhook endpoints.
- `POST /v1/webhooks`: Register a new webhook endpoint.
- `POST /v1/webhooks/:id/test`: Send a test ping event.
- `GET /v1/webhooks/deliveries`: Inspect delivery logs.
- `POST /v1/webhooks/deliveries/:id/retry`: Manually re-trigger a failed delivery.

---

### 5.7 System Endpoints

- `GET /v1/health`: System health check (database latency, OCR readiness, storage).
- `GET /v1/audit-logs`: Query tenant audit events.
- `GET /v1/openapi.json`: OpenAPI 3.1 specification.

---

## 6. HTTP Status & Error Codes

All errors return a standard JSON structure:
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Specific error description",
  "requestId": "req_5a1f6c8d-2e4b-4c7a-9a1f-0b3c2d1e4f5a"
}
```

| HTTP Code | Error | Meaning |
| :--- | :--- | :--- |
| `200` | OK | Request succeeded. |
| `201` | Created | Resource successfully created. |
| `400` | Bad Request | Validation failure, invalid amount, or unconfigured method. |
| `401` | Unauthorized | Missing, invalid, or revoked API key. |
| `403` | Forbidden | Insufficient scope or suspended tenant account. |
| `404` | Not Found | Resource not found or belongs to another tenant. |
| `422` | Unprocessable Entity | File signature check failed or file size exceeded. |
| `500` | Internal Server Error | Unhandled backend exception. |

---

## 7. Webhook Signatures & Verification

SysGalaxy delivers webhooks with HMAC-SHA256 signatures in the `X-SysGalaxy-Signature` header:

```http
X-SysGalaxy-Signature: t=1760662200,v1=9f83...6a1b
```

### Signature Verification Algorithm
1. Extract `t` (Unix timestamp) and `v1` (hex digest).
2. Compute:
   $$\text{HMAC-SHA256}(secret, t + "." + rawPayload)$$
3. Perform a constant-time comparison against `v1`.
4. Validate that $|now - t| \le 300\text{ seconds}$ to protect against replay attacks.

### Node.js / TypeScript Verification Example
```typescript
import crypto from 'node:crypto';

export function verifyGatewayWebhook(header: string, rawPayload: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
  const timestamp = parseInt(parts.t, 10);
  const signature = parts.v1;

  // Replay protection: 5 minutes tolerance
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawPayload}`)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}
```
