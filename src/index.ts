import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { buildApp } from './app.js';
import { runMigrations, seedInitialData } from './db/migrate.js';
import { closeDb } from './db/index.js';
import { GmailBankAlertPoller } from './modules/bank-feeds/gmail-poller.js';

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx < process.argv.length - 1 ? process.argv[idx + 1] : undefined;
}

const PORT = parseInt(getArg('--port') || process.env.PORT || '3000', 10);
const HOST = getArg('--host') || process.env.HOST || '0.0.0.0';

// Trigger background dashboard build if dist index.html is missing
const distIndex = path.resolve(process.cwd(), 'dashboard', 'dist', 'index.html');
if (!fs.existsSync(distIndex)) {
  console.log('⚡ Dashboard dist not found, compiling in background...');
  exec('npm run build:dashboard', (err, stdout) => {
    if (err) console.error('Dashboard build error:', err);
    else console.log('✅ Dashboard built successfully.');
  });
}

async function main() {
  console.log('🚀 Initializing SysGalaxy Payment Verification Gateway...');

  // Auto-run database migrations and default seed data
  try {
    await runMigrations();
    const seed = await seedInitialData();
    console.log(`✅ Database ready. Default Tenant: ${seed.tenantId}`);
    console.log(`🔑 Demo Test Key: ${seed.testApiKey}`);
  } catch (err) {
    console.error('❌ Database migration error:', err);
    process.exit(1);
  }

  const app = buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`⚡ SysGalaxy Gateway API listening on http://${HOST}:${PORT}`);
    console.log(`📖 OpenAPI Spec: http://${HOST}:${PORT}/v1/openapi.json`);
    console.log(`🩺 Health Check: http://${HOST}:${PORT}/v1/health`);

    // Start background Gmail Bank Alert Poller
    GmailBankAlertPoller.start();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    try {
      GmailBankAlertPoller.stop();
      await app.close();
      await closeDb();
      console.log('👋 SysGalaxy Gateway shut down cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (err: any) => {
    console.error('⚠️ Uncaught Exception intercepted (prevented server crash):', err?.message || err);
  });
  process.on('unhandledRejection', (reason: any) => {
    console.error('⚠️ Unhandled Rejection intercepted (prevented server crash):', reason?.message || reason);
  });
}

main();
