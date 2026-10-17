# SysGalaxy Payment Verification Gateway — Testing Guide

This document describes the automated testing architecture, test suites, edge case validations, and instructions for running tests in **SysGalaxy Payment Verification Gateway**.

---

## 1. Test Architecture Overview

SysGalaxy uses **Vitest** for fast, deterministic unit and integration testing.

Because SysGalaxy supports an embedded PostgreSQL engine (`@electric-sql/pglite`), tests execute against a **real PostgreSQL relational database** in-memory without requiring external databases, Docker daemons, or network mocks.

---

## 2. Test Suites & Coverage

| Test File | Test Cases | Areas Tested |
| :--- | :--- | :--- |
| `tests/api-auth.test.ts` | 5 | Missing keys, invalid keys, Bearer & X-API-Key headers, key revocation, scope enforcement. |
| `tests/tenant-isolation.test.ts` | 2 | Multi-tenant isolation: Tenant 2 cannot see Tenant 1's payment requests, API keys, or webhooks. |
| `tests/payment-workflow.test.ts` | 5 | Integer paisa creation, rupees conversion, idempotency caching (`X-Cache-Lookup`), cancellation, invalid method rejection. |
| `tests/verification-engine.test.ts` | 4 | **CRITICAL Invariant**: OCR extraction alone defaults to `pending_review`; duplicate receipt SHA-256 rejection; manual review approval; manual review rejection. |
| `tests/webhooks.test.ts` | 4 | HMAC-SHA256 signature generation, verification, tampered payload rejection, replay attack window protection. |
| `tests/tailor-os-e2e.test.ts` | 1 | Complete user journey: Tailor OS creates request $\rightarrow$ customer uploads receipt $\rightarrow$ pending review $\rightarrow$ compliance approval $\rightarrow$ signed webhook $\rightarrow$ subscription activated. |

**Total Coverage: 6 Suites, 21 Automated Tests, 100% Passing.**

---

## 3. How to Run Tests

### Running the Entire Test Suite
```bash
npm test
```

### Running in Watch Mode
```bash
npm run test:watch
```

### Running an Individual Suite
```bash
npx vitest run tests/tailor-os-e2e.test.ts
npx vitest run tests/verification-engine.test.ts
```

---

## 4. Synthetic Test Fixtures Policy

> **Zero Real Data Rule**: In strict compliance with financial security standards, real customer payment slips, CNIC numbers, or live banking account statements are **never** used in test fixtures.

All tests utilize synthetic, generated PNG buffers and programmatic mock receipts generated via `createMockPngBuffer()`.
