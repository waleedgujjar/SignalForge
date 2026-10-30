import './load-env.js';

import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { loadEnv } from '@signalforge/config';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { mailboxRoutes } from './routes/mailboxes.js';
import { campaignRoutes } from './routes/campaigns.js';
import { leadDiscoveryRoutes } from './routes/lead-discovery.js';
import { leadRoutes } from './routes/leads.js';
import { suppressionRoutes } from './routes/suppressions.js';
import { verificationRoutes } from './routes/verification.js';
import { userRoutes } from './routes/users.js';
import { integrationRoutes } from './routes/integrations.js';
import { driveImportRoutes } from './routes/drive-import.js';
import { websiteIntelligenceRoutes } from './routes/website-intelligence.js';
import { leadEnrichmentRoutes } from './routes/lead-enrichment.js';
import { leadResearchRoutes } from './routes/lead-research.js';
import { sendingRoutes } from './routes/sending.js';
import { smtpPoolRoutes } from './routes/smtp-pools.js';
import { smtpRotationRoutes } from './routes/smtp-rotation.js';
import { warmupRoutes } from './routes/warmup.js';
import { inboxRoutes } from './routes/inbox.js';
import { deliverabilityRoutes } from './routes/deliverability.js';
import { analyticsRoutes } from './routes/analytics.js';
import { automationsRoutes } from './routes/automations.js';
import { smartImportRoutes } from './routes/smart-import.js';
import { uploadRoutes } from './routes/uploads.js';
import { stagingRoutes } from './routes/staging.js';
import { unsubscribeRoutes } from './routes/unsubscribe.js';
import { trackingRoutes } from './routes/tracking.js';
import { closeAllQueues } from './queue-registry.js';

export async function buildApp() {
  const env = loadEnv();
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
    trustProxy: true,
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
    // Lead imports send parsed spreadsheet rows as JSON (up to 10k rows).
    bodyLimit: 12 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      const allowed = new Set([env.APP_URL]);
      if (env.NODE_ENV !== 'production') {
        allowed.add('http://localhost:3000');
        allowed.add('http://127.0.0.1:3000');
      }
      if (!origin || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(cookie, {
    secret: env.SESSION_SECRET,
  });

  await app.register(multipart, {
    // Large lead imports are streamed to disk, not buffered in memory.
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  app.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header('x-request-id', _request.id);
    done(null, payload);
  });

  app.setErrorHandler((err, request, reply) => {
    const error = err as Error & { statusCode?: number; code?: string; issues?: unknown };

    if (error.name === 'ZodError') {
      return reply.status(400).send({
        error: 'Validation failed',
        issues: error.issues,
      });
    }

    if (error.statusCode === 429) {
      return reply.status(429).send({ error: 'Too many requests' });
    }

    if (error.code?.startsWith?.('P')) {
      request.log.error({ err: error }, 'Database error');
      return reply.status(500).send({ error: 'Internal server error' });
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    request.log.error({ err: error, requestId: request.id }, 'Unhandled error');
    return reply.status(500).send({ error: 'Internal server error' });
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
  });

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(unsubscribeRoutes, { prefix: '/unsubscribe' });
  // Public (unauthenticated) email open-tracking pixel; recipients' mail clients
  // load it directly, so no workspace guard.
  await app.register(trackingRoutes, { prefix: '/tracking' });

  await app.register(
    async (authScope) => {
      await authScope.register(rateLimit, {
        max: 10,
        timeWindow: '1 minute',
      });
      await authScope.register(authRoutes);
    },
    { prefix: '/auth' },
  );

  await app.register(workspaceRoutes, { prefix: '/workspaces' });
  await app.register(mailboxRoutes, { prefix: '/mailboxes' });
  await app.register(campaignRoutes, { prefix: '/campaigns' });
  await app.register(leadRoutes, { prefix: '/leads' });
  await app.register(suppressionRoutes, { prefix: '/suppressions' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(integrationRoutes, { prefix: '/integrations' });
  await app.register(driveImportRoutes, { prefix: '/drive' });
  await app.register(smtpPoolRoutes, { prefix: '/smtp-pools' });
  await app.register(smtpRotationRoutes, { prefix: '/smtp-rotation' });
  await app.register(warmupRoutes, { prefix: '/warmup' });
  await app.register(inboxRoutes, { prefix: '/inbox' });
  await app.register(deliverabilityRoutes, { prefix: '/deliverability' });
  await app.register(analyticsRoutes, { prefix: '/analytics' });
  await app.register(automationsRoutes, { prefix: '/automations' });
  await app.register(smartImportRoutes, { prefix: '/leads' });
  await app.register(uploadRoutes, { prefix: '/uploads' });
  await app.register(stagingRoutes, { prefix: '/staging' });

  const expensiveRateLimit = { max: 60, timeWindow: '1 minute' as const };
  await app.register(async (scope) => {
    await scope.register(rateLimit, expensiveRateLimit);
    await scope.register(leadDiscoveryRoutes);
  }, { prefix: '/lead-discovery' });
  await app.register(async (scope) => {
    await scope.register(rateLimit, expensiveRateLimit);
    await scope.register(leadEnrichmentRoutes);
  }, { prefix: '/lead-enrichment' });
  await app.register(async (scope) => {
    await scope.register(rateLimit, expensiveRateLimit);
    await scope.register(leadResearchRoutes);
  }, { prefix: '/lead-research' });
  await app.register(async (scope) => {
    await scope.register(rateLimit, expensiveRateLimit);
    await scope.register(websiteIntelligenceRoutes);
  }, { prefix: '/website-intelligence' });
  await app.register(async (scope) => {
    await scope.register(rateLimit, expensiveRateLimit);
    await scope.register(verificationRoutes);
  }, { prefix: '/verification' });
  await app.register(async (scope) => {
    await scope.register(rateLimit, expensiveRateLimit);
    await scope.register(sendingRoutes);
  }, { prefix: '/sending' });

  app.get('/', async () => ({
    service: 'signalforge-api',
    status: 'ok',
    docs: '/health',
  }));

  // Close shared BullMQ queues (and their Redis connections) on shutdown.
  app.addHook('onClose', async () => {
    await closeAllQueues();
  });

  return app;
}
