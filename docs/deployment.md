# SysGalaxy Payment Verification Gateway — Deployment & Operations Guide

This guide covers local development, Docker deployment, production orchestration, database migrations, backups, and secret rotation for **SysGalaxy Payment Verification Gateway**.

---

## 1. Quick Start: Local Development (Zero Setup)

SysGalaxy features an embedded PostgreSQL engine (`@electric-sql/pglite`) for instant local development without installing Docker or external PostgreSQL servers.

```bash
# 1. Clone repository
git clone https://github.com/sysgalaxy/payment-os.git
cd payment-os

# 2. Install dependencies
npm install

# 3. Copy environment configuration
cp .env.example .env

# 4. Run database migrations and seed default test data
npm run db:migrate

# 5. Start API server in dev mode
npm run dev

# 6. Start React Admin Dashboard in a separate terminal
cd dashboard
npm install
npm run dev
```

- **API Server**: `http://localhost:3000`
- **OpenAPI 3.1 Spec**: `http://localhost:3000/v1/openapi.json`
- **Health Check**: `http://localhost:3000/v1/health`
- **Admin Dashboard**: `http://localhost:5173`

---

## 2. Docker & Containerized Deployment

SysGalaxy includes production Docker and Docker Compose definitions for running PostgreSQL 16, the Fastify API Gateway, and the React Dashboard together.

### 2.1 Starting with Docker Compose
```bash
docker compose up -d --build
```

### 2.2 Verifying Services
```bash
docker compose ps
docker compose logs -f gateway
```

---

## 3. Production Environment Checklist

Ensure the following variables are securely populated in production:

| Variable | Recommended Value | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production optimizations and disables debug traces. |
| `PORT` | `3000` | Port for the API server. |
| `HOST` | `0.0.0.0` | Bind address. |
| `DATABASE_URL` | `postgresql://user:password@pg-host:5432/sysgalaxy_prod` | PostgreSQL 15+ connection string. |
| `STORAGE_ADAPTER` | `local` (or `s3`) | Storage destination for receipt images. |
| `STORAGE_LOCAL_DIR` | `/var/sysgalaxy/uploads` | Private, secure upload directory with `0700` permissions. |
| `MASTER_ADMIN_KEY` | 64-character random hex string | Root emergency admin credential. |
| `CORS_ORIGIN` | `https://dashboard.sysgalaxy.io` | Restrict allowed origins in production. |
| `WEBHOOK_TIMEOUT_MS` | `10000` | Webhook timeout before triggering exponential backoff retry. |

---

## 4. Production Database Migrations & Seeding

Migrations are idempotent and run automatically at application boot. To run migrations manually during a CI/CD deployment pipeline:

```bash
npm run db:migrate
```

---

## 5. Database Backups & Disaster Recovery

### Creating a Backup
```bash
pg_dump -U sysgalaxy_user -h localhost -d sysgalaxy_db -F c -b -v -f /backups/sysgalaxy_$(date +%Y%m%d_%H%M%S).dump
```

### Restoring from Backup
```bash
pg_restore -U sysgalaxy_user -h localhost -d sysgalaxy_db -v -c /backups/sysgalaxy_backup.dump
```

---

## 6. Secret Rotation Procedure

### Rotating a Merchant API Key
1. Generate a new key in the Dashboard or via `POST /v1/api-keys/:id/rotate`.
2. Update the secret key in the connected software's environment configuration (e.g. Tailor OS).
3. Verify that new payment requests authenticate successfully with the new key.
4. Revoke the old key via `POST /v1/api-keys/:id/revoke`.

### Rotating a Webhook Secret
1. Create a new webhook endpoint with the updated secret.
2. Update the receiver's verification secret.
3. Remove or deactivate the deprecated endpoint.
