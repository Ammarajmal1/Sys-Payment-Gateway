import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import crypto from 'node:crypto';
import { systemRoutes } from './modules/system/routes.js';
import { paymentRequestRoutes } from './modules/payment-requests/routes.js';
import { paymentRoutes } from './modules/payments/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { bankFeedRoutes } from './modules/bank-feeds/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { openApiSpecification } from './docs/openapi-spec.js';

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
    origin: (origin, cb) => {
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
