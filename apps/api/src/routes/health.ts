import type { FastifyPluginAsync } from 'fastify';
import { checkDatabaseConnection } from '@signalforge/database';
import { QUEUE_NAMES, checkRedisConnection } from '@signalforge/queue';
import { checkAIHealth } from '@signalforge/ai';
import { loadEnv } from '@signalforge/config';
import {
  dependencyHealthSchema,
  healthResponseSchema,
} from '@signalforge/validation';
import { authenticateAndRequireWorkspace } from '../plugins/auth.js';
import { getQueue } from '../queue-registry.js';

const SERVICE_NAME = 'signalforge-api';
const VERSION = '0.0.1';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    const payload = healthResponseSchema.parse({
      status: 'ok',
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
      version: VERSION,
    });

    return payload;
  });

  app.get('/db', { preHandler: authenticateAndRequireWorkspace }, async () => {
    const result = await checkDatabaseConnection();
    const payload = dependencyHealthSchema.parse({
      status: result.ok ? 'ok' : 'error',
      service: 'postgresql',
      timestamp: new Date().toISOString(),
      latencyMs: result.latencyMs,
      error: result.error,
    });

    return payload;
  });

  app.get('/redis', { preHandler: authenticateAndRequireWorkspace }, async () => {
    const env = loadEnv();
    const result = await checkRedisConnection(env.REDIS_URL);
    const payload = dependencyHealthSchema.parse({
      status: result.ok ? 'ok' : 'error',
      service: 'redis',
      timestamp: new Date().toISOString(),
      latencyMs: result.latencyMs,
      error: result.error,
    });

    return payload;
  });

  app.get('/queues', { preHandler: authenticateAndRequireWorkspace }, async () => {
    const queueNames = Object.values(QUEUE_NAMES);
    // Reuse the shared, long-lived queues (closed on app shutdown) instead of
    // opening and closing a Redis connection per health poll.
    const results: Record<string, Record<string, number>> = {};
    await Promise.all(
      queueNames.map(async (name) => {
        results[name] = await getQueue(name).getJobCounts();
      }),
    );
    return { status: 'ok', queues: results };
  });

  app.get('/ai', { preHandler: authenticateAndRequireWorkspace }, async () => {
    const env = loadEnv();
    const result = checkAIHealth({
      provider: env.AI_PROVIDER,
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
      model: env.OPENAI_MODEL,
    });
    const payload = dependencyHealthSchema.parse({
      status: result.ok ? 'ok' : 'error',
      service: `ai:${result.provider}`,
      timestamp: new Date().toISOString(),
      error: result.error,
    });

    return payload;
  });
};
