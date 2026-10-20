import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { systemRoutes } from './modules/system/routes.js';
import { paymentRequestRoutes } from './modules/payment-requests/routes.js';
import { paymentRoutes } from './modules/payments/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { bankFeedRoutes } from './modules/bank-feeds/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { openApiSpecification } from './docs/openapi-spec.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : {
      level: 'info',
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            hostname: req.hostname,
            remoteAddress: req.ip,
            requestId: req.id,
          };
        },
      },
    },
    genReqId: () => `req_${crypto.randomUUID()}`,
  });

  // Enable CORS
  app.register(cors, {
    origin: (_origin, cb) => {
      // Allow all in dev / local test, or check whitelist
      cb(null, true);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'Idempotency-Key', 'X-Test-OCR-Text'],
  });

  // Enable multipart file uploads (up to 10MB)
  app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 1,
    },
  });

  // Serve OpenAPI 3.1 specification
  app.get('/v1/openapi.json', async (_req, reply) => {
    reply.header('Content-Type', 'application/json').send(openApiSpecification);
  });

  // Register API modules
  app.register(authRoutes);
  app.register(systemRoutes);
  app.register(paymentRequestRoutes);
  app.register(paymentRoutes);
  app.register(settingsRoutes);
  app.register(bankFeedRoutes);

  // Serve Dashboard Static Assets & SPA Fallback
  const dashboardDistDir = path.resolve(process.cwd(), 'dashboard', 'dist');

  app.setNotFoundHandler(async (request, reply) => {
    const reqPath = (request.url || '/').split('?')[0];
    const isReadMethod = request.method === 'GET' || request.method === 'HEAD';

    // Return JSON 404 for API routes or non-GET/HEAD requests
    if (!isReadMethod || reqPath.startsWith('/v1/') || reqPath === '/v1') {
      reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Route ${request.method}:${request.url} not found`,
        requestId: request.id,
      });
      return;
    }

    if (fs.existsSync(dashboardDistDir)) {
      const safeRelativePath = path.normalize(reqPath).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '');
      const candidatePath = path.join(dashboardDistDir, safeRelativePath);

      if (
        safeRelativePath &&
        candidatePath.startsWith(dashboardDistDir) &&
        fs.existsSync(candidatePath) &&
        fs.statSync(candidatePath).isFile()
      ) {
        const ext = path.extname(candidatePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const content = await fs.promises.readFile(candidatePath);
        reply.header('Content-Type', contentType).status(200).send(request.method === 'HEAD' ? undefined : content);
        return;
      }

      const indexHtmlPath = path.join(dashboardDistDir, 'index.html');
      if (fs.existsSync(indexHtmlPath)) {
        const html = await fs.promises.readFile(indexHtmlPath);
        reply.header('Content-Type', 'text/html; charset=utf-8').status(200).send(request.method === 'HEAD' ? undefined : html);
        return;
      }
    }

    // If requesting frontend HTML and dist is not ready yet, serve a friendly 200 OK warmup page with auto-refresh
    if (isReadMethod && (reqPath === '/' || !path.extname(reqPath))) {
      reply.header('Content-Type', 'text/html; charset=utf-8').status(200).send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>SysGalaxy — Loading</title>
  <meta http-equiv="refresh" content="2">
  <style>
    body { background: #090d16; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: rgba(255,255,255,0.05); padding: 2rem 2.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h2 style="margin: 0 0 0.5rem; color: #3b82f6;">SysGalaxy Payment Gateway</h2>
    <p style="margin: 0; color: #94a3b8; font-size: 0.95rem;">Preparing interface, refreshing automatically...</p>
  </div>
</body>
</html>`);
      return;
    }

    reply.status(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: `Route ${request.method}:${request.url} not found`,
      requestId: request.id,
    });
  });

  // Global Error Handler
  app.setErrorHandler((error: any, request, reply) => {
    const statusCode = error.statusCode || 500;
    const isClientError = statusCode < 500;

    if (!isClientError) {
      request.log.error(error);
    }

    reply.status(statusCode).send({
      statusCode,
      error: error.name || 'InternalServerError',
      message: error.message || 'An unexpected server error occurred.',
      requestId: request.id,
    });
  });

  return app;
}
