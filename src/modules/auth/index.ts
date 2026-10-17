import { FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import { hashApiKey } from '../../utils/crypto.js';
import { verifySessionToken } from '../../utils/token.js';

export interface AuthenticatedTenant {
  id: string;
  name: string;
  slug: string;
  environment: 'test' | 'live';
  apiKeyId: string;
  keyPrefix: string;
  scopes: string[];
}

export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: AuthenticatedTenant;
    user?: AuthenticatedUser;
    requestId?: string;
  }
}

/**
 * Fastify preHandler hook to authenticate API Key and resolve tenant context
 */
export async function authenticateApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers['authorization'];
  const apiKeyHeader = request.headers['x-api-key'];

  let rawKey: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawKey = authHeader.substring(7).trim();
  } else if (typeof apiKeyHeader === 'string') {
    rawKey = apiKeyHeader.trim();
  }

  if (!rawKey) {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing API key. Please provide Authorization: Bearer <key> or X-API-Key header.',
    });
    return;
  }

  // 1. Check if token is a valid JWT Session Token (from Dashboard Login)
  const jwtSecret = process.env.GATEWAY_JWT_SECRET || 'sg_jwt_default_secret_key_sysgalaxy_secure_2026';
  if (rawKey.split('.').length === 3) {
    const sessionPayload = verifySessionToken(rawKey, jwtSecret);
    if (sessionPayload) {
      const db = await getDb();
      const tenantRes = await db.execute(sql`
        SELECT id, name, slug, status FROM tenants WHERE id = ${sessionPayload.tenantId} LIMIT 1
      `);

      if (tenantRes.rows.length > 0) {
        const t = tenantRes.rows[0];
        if (t.status !== 'active') {
          reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Merchant tenant account is suspended or inactive.',
          });
          return;
        }

        request.tenant = {
          id: t.id as string,
          name: t.name as string,
          slug: t.slug as string,
          environment: 'live',
          apiKeyId: 'session_token',
          keyPrefix: 'session',
          scopes: ['*'],
        };
        request.user = {
          userId: sessionPayload.userId,
          username: sessionPayload.username,
          role: sessionPayload.role,
        };
        return;
      }
    }
  }

  // Check for master admin key override for platform management
  const masterKey = process.env.MASTER_ADMIN_KEY || 'sg_live_master_admin_demo_secret_key_sysgalaxy';
  if (rawKey === masterKey) {
    // Look up default tenant
    const db = await getDb();
    const tenantRes = await db.execute(sql`SELECT id, name, slug FROM tenants LIMIT 1`);
    if (tenantRes.rows.length > 0) {
      const t = tenantRes.rows[0];
      request.tenant = {
        id: t.id as string,
        name: t.name as string,
        slug: t.slug as string,
        environment: 'live',
        apiKeyId: 'master_admin',
        keyPrefix: 'sg_live_master',
        scopes: ['*'],
      };
      return;
    }
  }

  const keyHash = hashApiKey(rawKey);
  const db = await getDb();

  const result = await db.execute(sql`
    SELECT
      k.id as key_id,
      k.key_prefix,
      k.environment,
      k.scopes,
      k.is_revoked,
      t.id as tenant_id,
      t.name as tenant_name,
      t.slug as tenant_slug,
      t.status as tenant_status
    FROM api_keys k
    JOIN tenants t ON t.id = k.tenant_id
    WHERE k.key_hash = ${keyHash}
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid API key provided.',
    });
    return;
  }

  const row = result.rows[0];

  if (row.is_revoked) {
    reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'API key has been revoked.',
    });
    return;
  }

  if (row.tenant_status !== 'active') {
    reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Merchant tenant account is suspended or inactive.',
    });
    return;
  }

  // Update last_used_at timestamp asynchronously
  setImmediate(async () => {
    try {
      await db.execute(sql`
        UPDATE api_keys
        SET last_used_at = NOW()
        WHERE id = ${row.key_id}
      `);
    } catch {
      // Non-blocking update failure
    }
  });

  const rawScopes = row.scopes;
  const scopes = Array.isArray(rawScopes) ? (rawScopes as string[]) : ['*'];

  request.tenant = {
    id: row.tenant_id as string,
    name: row.tenant_name as string,
    slug: row.tenant_slug as string,
    environment: row.environment as 'test' | 'live',
    apiKeyId: row.key_id as string,
    keyPrefix: row.key_prefix as string,
    scopes,
  };
}

/**
 * Fastify preHandler to enforce specific permission scopes
 */
export function requireScope(requiredScope: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.tenant) {
      reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required.',
      });
      return;
    }

    const { scopes } = request.tenant;
    const hasScope = scopes.includes('*') || scopes.includes(requiredScope);

    if (!hasScope) {
      reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: `Insufficient permissions. Required scope: '${requiredScope}'`,
      });
      return;
    }
  };
}
