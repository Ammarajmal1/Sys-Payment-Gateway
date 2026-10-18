import { getDb } from '../../db/index.js';
import { sql } from 'drizzle-orm';

export interface AuditLogParams {
  tenantId: string;
  actorType: 'api_key' | 'user' | 'system' | 'anonymous';
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

export class AuditLogger {
  static async log(params: AuditLogParams): Promise<void> {
    try {
      const db = await getDb();
      await db.execute(sql`
        INSERT INTO audit_events (
          tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata, ip_address
        ) VALUES (
          ${params.tenantId},
          ${params.actorType},
          ${params.actorId},
          ${params.action},
          ${params.entityType},
          ${params.entityId},
          ${JSON.stringify(params.metadata || {})}::jsonb,
          ${params.ipAddress ?? null}
        )
      `);
    } catch (err) {
      console.error('Failed to write audit event:', err);
    }
  }
}
