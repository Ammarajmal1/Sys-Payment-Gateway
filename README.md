# SysGalaxy Payment Verification Gateway

[![Tests](https://img.shields.io/badge/tests-21%20passed-success.svg)](#testing)
[![TypeScript](https://img.shields.io/badge/typescript-v5.8-blue.svg)](#architecture)
[![Fastify](https://img.shields.io/badge/fastify-v5.1-black.svg)](#architecture)
[![PostgreSQL](https://img.shields.io/badge/postgresql-16%20%7C%20pglite-336791.svg)](#architecture)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#license)

**SysGalaxy Payment Verification Gateway** is an enterprise-grade, API-first software product that connects with **Tailor OS** and third-party SaaS, ERP, e-commerce, and POS applications to verify electronic payments involving **Easypaisa**, **JazzCash**, and **1Link Bank Transfers**.

---

## 🌟 Key Highlights & Core Invariants

1. **Standalone & Universal**: Standalone gateway product with tenant isolation. Not hard-coded only for Tailor OS.
2. **Integer Paisa Financial Math**: All monetary amounts are handled as **64-bit integer paisa** ($1\text{ PKR} = 100\text{ paisa}$) to eliminate floating-point rounding errors.
3. **Local Self-Hosted OCR (No Paid AI)**: Uses **Tesseract.js** to parse Pakistani receipts locally. **Zero LLM or paid AI API dependencies.**
4. **Untrusted OCR Boundary**: OCR extractions are treated as untrusted customer input. The system **never** marks a payment verified solely because OCR extracted an amount or because a customer uploaded a screenshot.
5. **Deterministic Verification Engine**: Executes 8 strict TypeScript rules checking expiry, duplicate receipt SHA-256 hashes, duplicate transaction references, exact amounts, currencies, and destination accounts.
6. **Compliance Manual Review Queue**: In the absence of an authenticated enterprise provider API or 1Link Host-to-Host statement, payments are safely queued in `pending_review` for authorized human review with a mandatory audit trail.
7. **HMAC-SHA256 Signed Webhooks**: Cryptographically signed webhooks (`t=<timestamp>,v1=<signature>`) with 300-second replay attack protection and automatic exponential backoff retries.
8. **Multi-Tenant Architecture**: Strict row-level tenant boundaries, SHA-256 hashed API keys (`sg_test_...` and `sg_live_...`), and isolated audit logs.
9. **Tailor OS Reference Integration**: Complete working integration client demonstrating that Tailor OS **never** activates a paid subscription while a payment is in `pending_review`.
10. **Modern React Admin Dashboard**: 11-page responsive dashboard built in React + Vite with dark-theme Vanilla CSS.

---

## 🏗️ Architecture & Technology Stack

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **API Framework** | **Fastify v5** (Node.js 24 + TypeScript) | High throughput, strict schema validation, request ID tracking (`req_<uuid>`). |
| **Database** | **PostgreSQL** + **Embedded PGlite** via **Drizzle ORM** | 15 normalized tables. Embedded PGlite provides zero-dependency local dev and testing; node-postgres provides production scalability. |
| **OCR Processing** | **Tesseract.js** | Self-hosted, free, local OCR without external generative AI APIs. |
| **Security & Auth** | **SHA-256 Hashes** & **HMAC-SHA256** | Secure API key storage, constant-time signature verification, replay protection. |
| **File Storage** | **Pluggable Storage Adapter** | Local disk private storage (`0600` permissions) with random server-side names and path traversal guards. |
| **Admin Dashboard** | **React 19 + Vite 6** | Modern Vanilla CSS design system, dark-theme, responsive cards, 11 complete views. |
| **Testing** | **Vitest** | 21 comprehensive automated tests across 6 suites (100% passing). |

---

## 🚀 Quick Start (Zero Setup)

SysGalaxy runs out of the box with embedded PostgreSQL:

```bash
# 1. Install dependencies
npm install

# 2. Run migrations and seed demo tenant & test keys
npm run db:migrate

# 3. Start API Server
npm run dev
```

The gateway API will be available at:
- **API Server**: `http://localhost:3000`
- **Health Check**: `http://localhost:3000/v1/health`
- **OpenAPI 3.1 Spec**: `http://localhost:3000/v1/openapi.json`

### Starting the Admin Dashboard
In a second terminal:
```bash
cd dashboard
npm install
npm run dev
```
Open **`http://localhost:5173`** to access the 11-page compliance dashboard.

---

## 🧪 Automated Testing

SysGalaxy comes with an automated test suite verifying security invariants, tenant isolation, OCR handling, idempotency, and the Tailor OS billing journey:

```bash
npm test
```

### Test Suite Summary
```
 ✓ tests/verification-engine.test.ts (4 tests)
   ✓ CRITICAL: Never marks payment verified solely on OCR extraction; falls back to pending_review
   ✓ rejects a duplicate receipt with the exact same SHA-256 hash
   ✓ allows manual review approval with required evidence reference and audit trail
   ✓ allows manual review rejection with required reason
 ✓ tests/tailor-os-e2e.test.ts (1 test)
   ✓ executes the complete Tailor OS journey from creation to manual review and subscription activation
 ✓ tests/payment-workflow.test.ts (5 tests)
   ✓ creates payment request with integer paisa amount and returns instructions
   ✓ creates payment request using rupees amount and converts to paisa
   ✓ honors Idempotency-Key and returns cached response
   ✓ cancels an active payment request
   ✓ rejects an invalid payment method code
 ✓ tests/tenant-isolation.test.ts (2 tests)
   ✓ ensures Tenant 2 cannot see or access Tenant 1 payment requests
   ✓ ensures Tenant 2 cannot see Tenant 1 API keys
 ✓ tests/api-auth.test.ts (5 tests)
   ✓ rejects missing API key with 401
   ✓ rejects invalid API key with 401
   ✓ allows valid Bearer token
   ✓ allows X-API-Key header
   ✓ rejects revoked API key
 ✓ tests/webhooks.test.ts (4 tests)
   ✓ generates valid HMAC-SHA256 signature header
   ✓ rejects tampered payload
   ✓ rejects wrong secret
   ✓ rejects replayed webhook outside tolerance window

Test Files: 6 passed (6)
Tests:      21 passed (21)
```

---

## 📡 API Endpoints Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/v1/health` | Gateway health check and database latency. |
| `POST` | `/v1/payment-requests` | Create payment request (with idempotency support). |
| `GET` | `/v1/payment-requests/:id` | Retrieve payment request and payment instructions. |
| `GET` | `/v1/payment-requests` | List payment requests with pagination and filters. |
| `POST` | `/v1/payment-requests/:id/cancel` | Cancel an active payment request. |
| `POST` | `/v1/payment-requests/:id/receipt` | Upload customer receipt screenshot (OCR + verification). |
| `GET` | `/v1/payment-requests/:id/verification` | Retrieve full audit breakdown of verification checks. |
| `GET` | `/v1/payments` | List payments with status and verification method filters. |
| `GET` | `/v1/payments/:id` | Retrieve payment details with receipt and OCR data. |
| `POST` | `/v1/payments/:id/review/approve` | Compliance manual review approval with audit notes. |
| `POST` | `/v1/payments/:id/review/reject` | Compliance manual review rejection with reason. |
| `GET/POST` | `/v1/api-keys` | List and generate merchant API keys. |
| `POST` | `/v1/api-keys/:id/revoke` | Revoke an API key. |
| `POST` | `/v1/api-keys/:id/rotate` | Rotate an existing API key. |
| `GET/POST` | `/v1/payment-methods` | List and configure payment methods and limits. |
| `PUT` | `/v1/payment-methods/:id` | Update payment method instructions and account numbers. |
| `GET/POST` | `/v1/webhooks` | List and register webhook endpoints. |
| `POST` | `/v1/webhooks/:id/test` | Dispatch test ping event. |
| `GET` | `/v1/webhooks/deliveries` | Webhook delivery history and retry status. |
| `POST` | `/v1/webhooks/deliveries/:id/retry`| Retry a failed webhook delivery. |
| `GET` | `/v1/audit-logs` | Query immutable tenant security audit events. |
| `GET` | `/v1/openapi.json` | OpenAPI 3.1 schema. |

---

## 📖 Documentation Sitemap

- [API Reference Manual](docs/api.md)
- [OpenAPI 3.1 YAML Specification](docs/openapi.yaml)
- [System Architecture & State Machines](docs/architecture.md)
- [Database Schema (15 Tables & Drizzle ORM)](docs/database-schema.md)
- [Security & Threat Model](docs/security.md)
- [Tailor OS & Third-Party Integration Guide](docs/tailor-os-integration.md)
- [Webhooks & Signature Verification](docs/webhooks.md)
- [Deployment & Docker Guide](docs/deployment.md)
- [Environment Variables Checklist](docs/environment-variables.md)
- [Testing Manual](docs/testing.md)
- [Troubleshooting & Diagnostics](docs/troubleshooting.md)
- [Implementation Plan & Status](docs/implementation-plan.md)
- [Master Prompt Requirements](MASTER_PROMPT.md)

---

## 🐳 Docker Deployment

To launch with PostgreSQL 16 and Docker Compose:

```bash
docker compose up -d --build
```

---

## 📄 License
This project is licensed under the MIT License.
