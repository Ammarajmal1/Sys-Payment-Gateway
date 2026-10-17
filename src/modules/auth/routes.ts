import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import { signSessionToken, verifySessionToken, timingSafeCompare } from '../../utils/token.js';
import { AuditLogger } from '../audit/index.js';

import dotenv from 'dotenv';
dotenv.config();

const LoginSchema = z.object({
  username: z.string().min(1, 'Username is required').trim(),
  password: z.string().min(1, 'Password is required'),
});

// In-memory rate limiting for login attempts
const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1. POST /v1/auth/login (Admin & Merchant Dashboard Login)
  // ---------------------------------------------------------------------------
  fastify.post('/v1/auth/login', async (request: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    dotenv.config();
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid login payload',
        details: parsed.error.flatten(),
      });
      return;
    }

    const { username, password } = parsed.data;
    const clientIp = request.ip || '127.0.0.1';
    const now = Date.now();

    // Rate Limiting Check
    const attemptRecord = failedAttempts.get(clientIp);
    if (attemptRecord) {
      if (attemptRecord.lockedUntil > now) {
        const remainingMinutes = Math.ceil((attemptRecord.lockedUntil - now) / 60000);
        reply.status(429).send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Too many failed login attempts. Please try again in ${remainingMinutes} minute(s).`,
        });
        return;
      }
      if (attemptRecord.lockedUntil <= now && attemptRecord.count >= 5) {
        // Reset after lockout window passes
        failedAttempts.delete(clientIp);
      }
    }

    const adminUser = (process.env.GATEWAY_ADMIN_USER || 'admin').trim();
    const gmailUser = process.env.GMAIL_USER?.trim();
    const adminPass = (process.env.GATEWAY_ADMIN_PASSWORD || 'SysGalaxy@Pass2026!').trim();
    const jwtSecret = (process.env.GATEWAY_JWT_SECRET || 'sg_jwt_default_secret_key_sysgalaxy_secure_2026').trim();

    let isAuthenticated = false;
    let authRole = 'admin';
    let authName = 'Gateway Administrator';
    let authUserId = 'admin_root';
    let targetTenantId: string | null = null;

    // A. Check against Environment Admin Credentials (accepts username or email, case-insensitive)
    const inputUser = username.trim().toLowerCase();
    const isUserMatch = 
      inputUser === adminUser.toLowerCase() ||
      (gmailUser && inputUser === gmailUser.toLowerCase());

    const isPassMatch = timingSafeCompare(password.trim(), adminPass);

    if (isUserMatch && isPassMatch) {
      isAuthenticated = true;
    }

    const db = await getDb();

    // B. If not env admin, check against database tenant_users
    if (!isAuthenticated) {
      const userRes = await db.execute(sql`
        SELECT u.id, u.tenant_id, u.email, u.name, u.role, u.password_hash
        FROM tenant_users u
        WHERE LOWER(u.email) = ${username.toLowerCase()}
        LIMIT 1
      `);

      if (userRes.rows.length > 0) {
        const dbUser = userRes.rows[0];
        // Compare password (plain or hashed)
        if (timingSafeCompare(password, dbUser.password_hash as string)) {
          isAuthenticated = true;
          authUserId = dbUser.id as string;
          authRole = dbUser.role as string;
          authName = dbUser.name as string;
          targetTenantId = dbUser.tenant_id as string;
        }
      }
    }

    // Failed Login Handler
    if (!isAuthenticated) {
      const current = failedAttempts.get(clientIp) || { count: 0, lockedUntil: 0 };
      const newCount = current.count + 1;
      const lockedUntil = newCount >= 5 ? now + 15 * 60 * 1000 : 0; // 15 min lockout
      failedAttempts.set(clientIp, { count: newCount, lockedUntil });

      const fallbackTenant = await db.execute(sql`SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`);
      const auditTenantId = (fallbackTenant.rows[0]?.id as string) || targetTenantId;

      if (auditTenantId) {
        await AuditLogger.log({
          tenantId: auditTenantId,
          actorType: 'anonymous',
          actorId: username,
          action: 'auth.login_failed',
          entityType: 'user_session',
          entityId: username,
          metadata: { clientIp, attempts: newCount },
          ipAddress: clientIp,
        });
      }

      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid username or password.',
      });
      return;
    }

    // Reset failed attempts on success
    failedAttempts.delete(clientIp);

    // Resolve tenant info
    let tenantRow: any;
    if (targetTenantId) {
      const tRes = await db.execute(sql`SELECT id, name, slug FROM tenants WHERE id = ${targetTenantId} LIMIT 1`);
      tenantRow = tRes.rows[0];
    } else {
      const tRes = await db.execute(sql`SELECT id, name, slug FROM tenants ORDER BY created_at ASC LIMIT 1`);
      tenantRow = tRes.rows[0];
    }

    const tenantId = (tenantRow?.id as string) || '00000000-0000-0000-0000-000000000000';
    const tenantName = (tenantRow?.name as string) || 'SysGalaxy Primary';
    const tenantSlug = (tenantRow?.slug as string) || 'sysgalaxy-primary';

    // Fetch active test or live API key for dashboard operations
    let defaultApiKey = 'sg_test_7f9a2e8c1b4d3f5a6b7c8d9e0f1a2b3c';
    const keyRes = await db.execute(sql`
      SELECT key_prefix, environment
      FROM api_keys
      WHERE tenant_id = ${tenantId} AND is_revoked = FALSE
      LIMIT 1
    `);
    if (keyRes.rows.length > 0) {
      // Use existing demo key or key prefix
      defaultApiKey = process.env.MASTER_ADMIN_KEY || defaultApiKey;
    }

    // Generate signed JWT Session Token (7 days expiry)
    const token = signSessionToken(
      {
        userId: authUserId,
        username,
        role: authRole,
        tenantId,
        exp: now + 7 * 24 * 60 * 60 * 1000,
      },
      jwtSecret
    );

    // Audit log
    await AuditLogger.log({
      tenantId,
      actorType: 'user',
      actorId: username,
      action: 'auth.login_success',
      entityType: 'user_session',
      entityId: authUserId,
      metadata: { role: authRole, clientIp },
      ipAddress: clientIp,
    });

    reply.status(200).send({
      success: true,
      token,
      user: {
        id: authUserId,
        username,
        name: authName,
        role: authRole,
      },
      tenant: {
        id: tenantId,
        name: tenantName,
        slug: tenantSlug,
      },
      apiKey: defaultApiKey,
      message: 'Authentication successful.',
    });
  });

  // ---------------------------------------------------------------------------
  // 2. GET /v1/auth/me (Check Session & Get Current User Profile)
  // ---------------------------------------------------------------------------
  fastify.get('/v1/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'No authorization token provided.',
      });
      return;
    }

    const rawToken = authHeader.substring(7).trim();
    const jwtSecret = process.env.GATEWAY_JWT_SECRET || 'sg_jwt_default_secret_key_sysgalaxy_secure_2026';
    const masterKey = process.env.MASTER_ADMIN_KEY || 'sg_live_master_admin_demo_secret_key_sysgalaxy';

    // 1. Session Token
    if (rawToken.split('.').length === 3) {
      const payload = verifySessionToken(rawToken, jwtSecret);
      if (!payload) {
        reply.status(401).send({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Session token has expired or is invalid.',
        });
        return;
      }

      const db = await getDb();
      const tRes = await db.execute(sql`SELECT id, name, slug FROM tenants WHERE id = ${payload.tenantId} LIMIT 1`);
      const tenant = tRes.rows[0] || { id: payload.tenantId, name: 'SysGalaxy Primary', slug: 'sysgalaxy-primary' };

      reply.status(200).send({
        authenticated: true,
        user: {
          id: payload.userId,
          username: payload.username,
          role: payload.role,
        },
        tenant,
        apiKey: masterKey,
      });
      return;
    }

    // 2. Master Admin Key or API Key
    if (rawToken === masterKey) {
      const db = await getDb();
      const tRes = await db.execute(sql`SELECT id, name, slug FROM tenants LIMIT 1`);
      const tenant = tRes.rows[0] || { id: 'default', name: 'SysGalaxy Primary', slug: 'sysgalaxy-primary' };

      reply.status(200).send({
        authenticated: true,
        user: {
          id: 'admin_root',
          username: 'admin',
          role: 'admin',
        },
        tenant,
        apiKey: masterKey,
      });
      return;
    }

    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid session token.',
    });
  });

  // ---------------------------------------------------------------------------
  // 3. POST /v1/auth/logout
  // ---------------------------------------------------------------------------
  fastify.post('/v1/auth/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.status(200).send({
      success: true,
      message: 'Logged out successfully.',
    });
  });
}
