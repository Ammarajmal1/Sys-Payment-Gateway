import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

export type Database = ReturnType<typeof drizzlePg<typeof schema>> | ReturnType<typeof drizzlePglite<typeof schema>>;

let dbInstance: Database | null = null;
let pgliteInstance: PGlite | null = null;
let pgPoolInstance: pg.Pool | null = null;

export async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && databaseUrl.trim().length > 0) {
    // Production / Docker PostgreSQL via node-postgres
    pgPoolInstance = new Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    dbInstance = drizzlePg(pgPoolInstance, { schema });
    return dbInstance;
  }

  const isTest = process.env.NODE_ENV === 'test';
  let dataDir: string | undefined = undefined;

  if (!isTest) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const resolvedDir = path.resolve(process.env.PGLITE_DATA_DIR || './data/pglite');
    fs.mkdirSync(resolvedDir, { recursive: true });

    // Clean up stale WASM postmaster.pid from ungraceful shutdown/reloads
    const pidFile = path.join(resolvedDir, 'postmaster.pid');
    if (fs.existsSync(pidFile)) {
      try {
        fs.unlinkSync(pidFile);
      } catch {
        // ignore
      }
    }

    dataDir = resolvedDir;
  }

  pgliteInstance = new PGlite(dataDir);
  await pgliteInstance.waitReady;
  dbInstance = drizzlePglite(pgliteInstance, { schema });
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  if (pgPoolInstance) {
    await pgPoolInstance.end();
    pgPoolInstance = null;
  }
  if (pgliteInstance) {
    await pgliteInstance.close();
    pgliteInstance = null;
  }
  dbInstance = null;
}
