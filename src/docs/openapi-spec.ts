export const openApiSpecification = {
  openapi: '3.1.0',
  info: {
    title: 'SysGalaxy Payment Verification Gateway API',
    version: '1.0.0',
    description:
      'Universal, multi-tenant payment verification gateway for Easypaisa, JazzCash, and Bank Transfers. Features local self-hosted OCR extraction, deterministic verification rules, manual review workflows, and HMAC-SHA256 signed webhooks.',
    contact: {
      name: 'SysGalaxy Gateway Engineering',
      email: 'support@sysgalaxy.io',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Provide your API Key (e.g. sg_test_... or sg_live_...) as a Bearer token.',
      },
      ApiKeyHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Alternative header for providing API Key.',
      },
    },
    schemas: {
      PaymentRequest: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          reference: { type: 'string', example: 'pr_test_7f9a2e8c1b' },
          order_reference: { type: 'string', example: 'tailor_sub_1082' },
          amount_paisa: { type: 'integer', example: 125000, description: 'Amount in integer paisa (1 PKR = 100 paisa)' },
          currency: { type: 'string', example: 'PKR' },
          payment_method_code: { type: 'string', example: 'jazzcash' },
          status: {
            type: 'string',
            enum: ['awaiting_payment', 'processing', 'pending_review', 'verified', 'rejected', 'expired', 'cancelled'],
          },
          verification_method: {
            type: ['string', 'null'],
            enum: ['provider_verified', 'manual_verified', null],
          },
          expires_at: { type: 'string', format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      PaymentInstructions: {
        type: 'object',
        properties: {
          payment_method: { type: 'string' },
          payment_method_code: { type: 'string' },
          account_title: { type: 'string' },
          account_identifier: { type: 'string' },
          bank_name: { type: ['string', 'null'] },
          amount_paisa: { type: 'integer' },
          amount_formatted: { type: 'string' },
          gateway_reference: { type: 'string' },
          step_by_step: { type: 'string' },
        },
      },
      WebhookPayload: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          eventType: { type: 'string', example: 'payment.verified' },
          createdAt: { type: 'string', format: 'date-time' },
          paymentRequestId: { type: 'string', format: 'uuid' },
          orderReference: { type: 'string' },
          amountPaisa: { type: 'integer' },
          currency: { type: 'string' },
          status: { type: 'string' },
          verificationMethod: { type: ['string', 'null'] },
          data: { type: 'object' },
        },
      },
    },
  },
  security: [
    { BearerAuth: [] },
    { ApiKeyHeader: [] },
  ],
  paths: {
    '/v1/health': {
      get: {
        summary: 'System health check',
        description: 'Returns gateway health, database connectivity, OCR readiness, and storage status.',
        security: [],
        responses: {
          '200': { description: 'System healthy' },
          '503': { description: 'System degraded' },
        },
      },
    },
    '/v1/payment-requests': {
      post: {
        summary: 'Create payment request',
        description: 'Initiate a new payment request and receive configured payment instructions.',
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['order_reference', 'payment_method_code'],
                properties: {
                  order_reference: { type: 'string', example: 'tailor_sub_1082' },
                  amount_paisa: { type: 'integer', example: 125000, description: 'Amount in paisa (e.g. 125000 for PKR 1,250.00)' },
                  amount: { type: 'number', example: 1250, description: 'Alternative: Amount in PKR rupees' },
                  currency: { type: 'string', default: 'PKR' },
                  payment_method_code: { type: 'string', example: 'jazzcash' },
                  customer_reference: { type: 'string', example: 'cust_991' },
                  customer_name: { type: 'string', example: 'Ahmad Khan' },
                  customer_email: { type: 'string', example: 'ahmad@example.com' },
                  customer_phone: { type: 'string', example: '03001234567' },
                  expires_in_minutes: { type: 'integer', default: 60 },
                  metadata: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Payment request created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    reference: { type: 'string' },
                    order_reference: { type: 'string' },
                    amount_paisa: { type: 'integer' },
                    currency: { type: 'string' },
                    status: { type: 'string' },
                    expires_at: { type: 'string' },
                    instructions: { $ref: '#/components/schemas/PaymentInstructions' },
                  },
                },
              },
            },
          },
          '400': { description: 'Bad Request / Invalid amount or payment method' },
          '401': { description: 'Unauthorized / Invalid or missing API key' },
        },
      },
      get: {
        summary: 'List payment requests',
        description: 'Paginated list of payment requests with filtering by status and order_reference.',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'order_reference', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          '200': { description: 'List of payment requests' },
        },
      },
    },
    '/v1/payment-requests/{id}': {
      get: {
        summary: 'Retrieve payment request details',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Payment request details' },
          '404': { description: 'Payment request not found' },
        },
      },
    },
    '/v1/payment-requests/{id}/cancel': {
      post: {
        summary: 'Cancel payment request',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Payment request cancelled' },
          '400': { description: 'Cannot cancel already verified request' },
        },
      },
    },
    '/v1/payment-requests/{id}/receipt': {
      post: {
        summary: 'Upload payment receipt screenshot',
        description: 'Upload receipt image (PNG, JPEG, WebP, PDF). Performs OCR extraction, runs deterministic verification checks, and triggers signed webhooks.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Receipt processed and evaluated by verification engine' },
          '400': { description: 'Invalid file signature or size exceeded' },
          '404': { description: 'Payment request not found' },
        },
      },
    },
    '/v1/payment-requests/{id}/verification': {
      get: {
        summary: 'Retrieve verification audit and checks',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Audit breakdown of verification checks' },
        },
      },
    },
    '/v1/payments': {
      get: {
        summary: 'List payments',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'verification_method', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'List of payments' },
        },
      },
    },
    '/v1/payments/{id}': {
      get: {
        summary: 'Retrieve payment by ID',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Payment details' },
        },
      },
    },
    '/v1/payments/{id}/review/approve': {
      post: {
        summary: 'Manually approve payment',
        description: 'Authorized merchant reviewer approves a pending payment with required evidence reference and audit notes.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['evidence_reference', 'notes'],
                properties: {
                  evidence_reference: { type: 'string', example: 'Bank Portal Ref #778899' },
                  notes: { type: 'string', example: 'Verified credit in Meezan Bank online portal at 14:30.' },
                  reviewer_name: { type: 'string', example: 'Finance Admin' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Payment approved as manual_verified' },
          '400': { description: 'Missing notes or evidence reference' },
        },
      },
    },
    '/v1/payments/{id}/review/reject': {
      post: {
        summary: 'Manually reject payment',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: { type: 'string', example: 'Credit not received in merchant account.' },
                  reviewer_name: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Payment rejected' },
        },
      },
    },
    '/v1/api-keys': {
      get: { summary: 'List API keys' },
      post: { summary: 'Create API key' },
    },
    '/v1/payment-methods': {
      get: { summary: 'List payment methods' },
      post: { summary: 'Configure payment method' },
    },
    '/v1/webhooks': {
      get: { summary: 'List webhook endpoints' },
      post: { summary: 'Create webhook endpoint' },
    },
    '/v1/webhooks/deliveries': {
      get: { summary: 'List webhook delivery logs' },
    },
    '/v1/audit-logs': {
      get: { summary: 'List tenant audit logs' },
    },
  },
};
