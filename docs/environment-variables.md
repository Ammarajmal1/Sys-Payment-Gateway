# SysGalaxy Payment Verification Gateway — Environment Variables Reference

This document details all configuration environment variables supported by **SysGalaxy Payment Verification Gateway**.

---

## 1. Core Server Configuration

### `NODE_ENV`
- **Type**: `string` (`"development"` | `"test"` | `"production"`)
- **Default**: `"development"`
- **Description**: Sets the operational environment. Disables verbose stack traces in production and configures logging.

### `PORT`
- **Type**: `integer`
- **Default**: `3000`
- **Description**: The TCP port on which Fastify listens.

### `HOST`
- **Type**: `string`
- **Default**: `"0.0.0.0"`
- **Description**: The network interface host IP address to bind.

### `API_BASE_URL`
- **Type**: `string`
- **Default**: `"http://localhost:3000"`
- **Description**: The public base URL used in generated webhook links and client instructions.

---

## 2. Database Configuration

### `DATABASE_URL`
- **Type**: `string` (PostgreSQL URI)
- **Default**: `""` (Empty string)
- **Description**: PostgreSQL connection string. When left empty, SysGalaxy automatically boots an embedded in-memory or file-backed PostgreSQL engine (`@electric-sql/pglite`) for effortless local dev and automated tests.
- **Example**: `postgresql://sysgalaxy_user:secure_pass@localhost:5432/sysgalaxy_db`

### `PGLITE_DATA_DIR`
- **Type**: `string`
- **Default**: `"./data/pglite"`
- **Description**: Filesystem directory used by the embedded PGlite engine when `DATABASE_URL` is empty.

---

## 3. File Storage Configuration

### `STORAGE_ADAPTER`
- **Type**: `string` (`"local"` | `"s3"`)
- **Default**: `"local"`
- **Description**: Selected storage adapter for persisting customer-uploaded payment receipts.

### `STORAGE_LOCAL_DIR`
- **Type**: `string`
- **Default**: `"./storage/uploads"`
- **Description**: Filesystem directory for receipt images when using the local adapter.

### `STORAGE_MAX_FILE_SIZE_BYTES`
- **Type**: `integer`
- **Default**: `10485760` (10 MB)
- **Description**: Maximum allowed upload size for receipt screenshots and documents.

---

## 4. OCR & Verification Configuration

### `OCR_ENGINE`
- **Type**: `string` (`"tesseract"`)
- **Default**: `"tesseract"`
- **Description**: OCR extraction engine. SysGalaxy uses self-hosted Tesseract.js and strictly avoids paid generative AI APIs.

### `OCR_CONFIDENCE_THRESHOLD`
- **Type**: `float`
- **Default**: `60.0`
- **Description**: Minimum confidence score below which OCR extractions are flagged as `low_confidence`.

---

## 5. Security & Authentication

### `MASTER_ADMIN_KEY`
- **Type**: `string`
- **Default**: `"sg_live_master_admin_demo_secret_key_sysgalaxy"`
- **Description**: High-entropy administrative emergency key for tenant initialization and debugging.

### `CORS_ORIGIN`
- **Type**: `string` (Comma-separated URLs)
- **Default**: `"http://localhost:5173,http://localhost:3000"`
- **Description**: Allowed CORS origins for the Admin Dashboard.

---

## 6. Webhook Dispatcher Configuration

### `WEBHOOK_TIMEOUT_MS`
- **Type**: `integer`
- **Default**: `10000` (10 seconds)
- **Description**: Network HTTP timeout when delivering signed webhooks to external software.

### `WEBHOOK_MAX_RETRIES`
- **Type**: `integer`
- **Default**: `5`
- **Description**: Maximum delivery attempts using exponential backoff before marking delivery as `failed`.

### `WEBHOOK_INITIAL_BACKOFF_MS`
- **Type**: `integer`
- **Default**: `1000` (1 second)
- **Description**: Initial delay before the first retry attempt ($delay = 2^{attempt} \times 1000\text{ms}$).
