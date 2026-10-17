# SysGalaxy Payment Verification Gateway — Security & Threat Model

This document outlines the security architecture, threat model, mitigation strategies, and compliance invariants enforced across **SysGalaxy Payment Verification Gateway**.

---

## 1. Security Invariants (Core Rules)

1. **Untrusted OCR Boundary**: All text, transaction references, numbers, and dates extracted via OCR from customer-submitted screenshots are strictly classified as **Untrusted Customer Input**. OCR extraction alone NEVER transitions a payment to `verified`.
2. **Mandatory Human Review Fallback**: In the absence of an authentic, cryptographically authenticated enterprise provider API or host-to-host bank statement, payments MUST transition to `pending_review` for human review.
3. **Backend Source of Truth**: The backend database is the sole authority on payment states. Neither the admin dashboard frontend nor integrating software may directly force a status to `verified` without passing through the verification rules or the authorized review endpoint with an audit trail.
4. **Zero Float Financial Arithmetic**: All financial calculations are executed using 64-bit integer paisa (1 PKR = 100 paisa) to eliminate rounding discrepancies and float exploits.

---

## 2. Threat Model & Mitigation Matrix

| Threat Vector | Attack Scenario | SysGalaxy Mitigation |
| :--- | :--- | :--- |
| **Duplicate Receipt Fraud** | Attacker uploads a real screenshot previously used for another purchase or by another customer. | **SHA-256 Digest Deduplication**: Every uploaded receipt buffer is hashed before storage. If an identical hash already exists for the merchant, the engine rejects the transaction immediately (`RECEIPT_HASH_UNIQUE` check fails). |
| **Duplicate Transaction ID** | Attacker fabricates an image reusing an existing transaction ID. | **Transaction Reference Deduplication**: Database unique constraints and pre-verification checks ensure a transaction ID cannot be claimed twice across verified or pending payments. |
| **Malicious File Uploads** | Attacker uploads a `.php`, `.exe`, or HTML file disguised as an image to achieve remote code execution. | **1. Magic Bytes Validation**: Inspects binary file headers (PNG: `89 50 4E 47`, JPEG: `FF D8 FF`, PDF: `%PDF`).<br>**2. Random Server-Side Filenames**: Files saved as `rec_<uuid>.ext`. Original user filenames are never used on the filesystem.<br>**3. Non-Executable Storage**: Stored outside web root with `0600` permissions. |
| **Directory Traversal** | Attacker uses `../` in storage paths to read system files (`/etc/passwd`). | **Path Traversal Guard**: Storage adapters resolve canonical paths and assert `resolvedPath.startsWith(baseUploadDir)`. |
| **Webhook Replay Attacks** | Man-in-the-middle captures a valid `payment.verified` webhook and replays it to activate a service repeatedly. | **Timestamp Validation & Tolerances**: Webhooks include `t=<timestamp>` in the signature. Receivers reject events older than 300 seconds.<br>**Duplicate Event ID Tracking**: Each event carries a unique UUID and idempotency key. |
| **Timing Attacks on Signatures** | Attacker measures comparison duration of HMAC signatures byte-by-byte to forge a valid signature. | **Constant-Time Comparison**: Webhook verification utilizes `crypto.timingSafeEqual` over fixed-length buffer digests. |
| **API Key Theft / DB Leak** | Attacker dumps the database and obtains raw API keys. | **Cryptographic Hashing**: Raw API keys (`sg_test_...`, `sg_live_...`) are hashed using SHA-256 before storage. Full secrets are shown only once upon creation. |
| **Cross-Tenant Data Exposure** | Merchant A crafts requests to view or approve Merchant B's payments. | **Tenant Authorization Boundary**: Every query enforces `WHERE tenant_id = request.tenant.id`. Foreign IDs return `404 Not Found`. |
| **Double Spending Race Condition** | Attacker submits concurrent verification requests for the same payment. | **PostgreSQL Transactions & Unique Constraints**: `payments.payment_request_id` has a unique constraint. Database transactions lock the payment row during review. |

---

## 3. Webhook Security Specification

SysGalaxy implements the industry standard HMAC-SHA256 signature scheme:

### Header Format
```http
X-SysGalaxy-Signature: t=1760662200,v1=a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0
```

### Signature Computation
$$\text{Signature} = \text{HMAC-SHA256}(K_{secret}, t + "." + \text{rawBody})$$

### Implementing Verification
Integrating applications must verify three conditions before processing a webhook:
1. **Timestamp Freshness**: $|now - t| \le 300\text{ seconds}$.
2. **Signature Authenticity**: $\text{HMAC-SHA256}(K_{secret}, t + "." + \text{rawBody}) == v1$ using constant-time comparison.
3. **Payload Parity**: Verify that `orderReference`, `amountPaisa`, and `currency` match the expected internal database record.

---

## 4. Compliance & Audit Logging

Every sensitive operation is recorded in the append-only `audit_events` table:
- API key creation, rotation, and revocation
- Payment request creation and cancellation
- Receipt uploads and file SHA-256 hashes
- Manual approvals (including required reviewer name, evidence reference, and explanation notes)
- Manual rejections (including required rejection reason)

Audit logs are tenant-scoped, tamper-evident, and accessible through `/v1/audit-logs` or the Admin Dashboard.
