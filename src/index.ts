import 'dotenv/config';
import { buildApp } from './app.js';
import { runMigrations, seedInitialData } from './db/migrate.js';
import { closeDb } from './db/index.js';
import { GmailBankAlertPoller } from './modules/bank-feeds/gmail-poller.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const rawHost = process.env.HOST;
// Bind to '::' (dual-stack) so Windows resolves localhost (::1) and 127.0.0.1 seamlessly
const HOST = (!rawHost || rawHost === '0.0.0.0') ? '::' : rawHost;

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
