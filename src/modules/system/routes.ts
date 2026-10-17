import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';
import { authenticateApiKey } from '../auth/index.js';

export async function systemRoutes(fastify: FastifyInstance): Promise<void> {
  // Public health check endpoint
  fastify.get('/v1/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    let dbStatus = 'ok';
    let dbLatencyMs = 0;

    const start = performance.now();
    try {
      const db = await getDb();
      await db.execute(sql`SELECT 1`);
      dbLatencyMs = Math.round(performance.now() - start);
    } catch (err: any) {
      dbStatus = `error: ${err.message}`;
    }

    const health = {
      status: dbStatus === 'ok' ? 'healthy' : 'degraded',
      service: 'SysGalaxy Payment Verification Gateway',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        status: dbStatus,
        latency_ms: dbLatencyMs,
        driver: process.env.DATABASE_URL ? 'postgresql' : 'pglite-embedded',
      },
      ocr_engine: {
        engine: 'tesseract.js',
        status: 'ready',
        self_hosted: true,
      },
      storage: {
        adapter: process.env.STORAGE_ADAPTER || 'local',
        status: 'ready',
      },
      environment: process.env.NODE_ENV || 'development',
    };

    reply.status(health.status === 'healthy' ? 200 : 503).send(health);
  });

  // Protected tenant audit logs endpoint
  fastify.get('/v1/audit-logs', { preHandler: [authenticateApiKey] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenant = request.tenant!;
    const parsedQuery = (request.query || {}) as { action?: string; limit?: string; offset?: string };
    const { action, limit = '50', offset = '0' } = parsedQuery;
    const db = await getDb();

    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

    let query = sql`
      SELECT id, actor_type, actor_id, action, entity_type, entity_id, metadata, ip_address, created_at
      FROM audit_events
      WHERE tenant_id = ${tenant.id}
    `;

    if (action) {
      query = sql`${query} AND action = ${action}`;
    }

    query = sql`${query} ORDER BY created_at DESC LIMIT ${limitNum} OFFSET ${offsetNum}`;

    const res = await db.execute(query);

    reply.send({
      items: res.rows,
      limit: limitNum,
      offset: offsetNum,
      count: res.rows.length,
    });
  });
}
