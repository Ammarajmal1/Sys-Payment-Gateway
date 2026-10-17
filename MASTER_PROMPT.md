# MASTER PROMPT — SysGalaxy Payment Verification Gateway

This document preserves the master requirements for **SysGalaxy Payment Verification Gateway**.

## 1. Role and Objective
Design, develop, test, and document a complete software product:
**SysGalaxy Payment Verification Gateway**
A standalone, API-first software product that connects with Tailor OS and other third-party software (ERP, SaaS, e-commerce, POS).

## 2. Supported Payment Methods
- Easypaisa
- JazzCash
- Bank Transfers
- Extensible architecture for future trusted providers

## 3. Core Workflow
1. **Create Payment Request**: `POST /v1/payment-requests` (amount in paisa, currency, method, expiry, order reference).
2. **Show Instructions**: Configured instructions returned for the selected payment method.
3. **Customer Makes Payment & Uploads Receipt**: `POST /v1/payment-requests/:id/receipt`.
4. **OCR Processing**: Local self-hostable OCR (Tesseract.js). Extracted fields treated as untrusted data.
5. **Deterministic Verification Engine**:
   - Belongs to tenant
   - Request not expired
   - Amount and currency match exactly (paisa integer)
   - Destination account matches
   - Transaction reference present and unique
   - Receipt SHA256 hash unique (duplicate detection)
   - Date plausibility
   - Independent trusted evidence check: NEVER auto-verify solely on OCR/screenshot. Fallback to `pending_review`.
6. **Verification Result**:
   - Statuses: `awaiting_payment`, `processing`, `pending_review`, `verified`, `rejected`, `expired`, `cancelled`
   - Methods: `provider_verified`, `manual_verified`, `null`
7. **Signed Webhooks**: HMAC-SHA256 signature with replay protection, retry backoff, and delivery logs.

## 4. Multi-Tenant Architecture
- Tenant-scoped data and queries
- Hashed API keys (`test_` / `live_`)
- Tenant-specific payment methods, instructions, webhooks, and audit logs
- Role-based manual review with required reason and evidence notes

## 5. Technology Stack
- Backend: Node.js (v24), TypeScript, Fastify
- Database: PostgreSQL (Drizzle ORM) with embedded PGlite support for zero-dependency local dev and testing
- OCR: Tesseract.js
- Validation: Zod
- Dashboard: React + Vite + Vanilla CSS
- Testing: Vitest
