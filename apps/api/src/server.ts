import './load-env.js';

import { loadEnv } from '@signalforge/config';
import { checkDatabaseConnection } from '@signalforge/database';
import { checkRedisConnection } from '@signalforge/queue';
import { buildApp } from './app.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;
const MAX_STARTUP_RETRIES = 5;

async function waitForDependencies(env: ReturnType<typeof loadEnv>): Promise<void> {
  const isProduction = env.NODE_ENV === 'production';
  const maxRetries = isProduction ? MAX_STARTUP_RETRIES : 1;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const db = await checkDatabaseConnection();
    const redis = await checkRedisConnection(env.REDIS_URL);

    if (db.ok && redis.ok) {
      console.info(
        JSON.stringify({
          service: 'signalforge-api',
          message: 'Dependencies ready',
          dbLatencyMs: db.latencyMs,
          redisLatencyMs: redis.latencyMs,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    const failures: string[] = [];
    if (!db.ok) failures.push(`PostgreSQL: ${db.error}`);
    if (!redis.ok) failures.push(`Redis: ${redis.error}`);

    if (attempt < maxRetries) {
      const delayMs = 1000 * Math.pow(2, attempt - 1);
      console.warn(
        JSON.stringify({
          service: 'signalforge-api',
          message: `Dependency check failed (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms`,
          failures,
          timestamp: new Date().toISOString(),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } else {
      throw new Error(`Dependencies unavailable after ${maxRetries} attempts: ${failures.join('; ')}`);
    }
  }
}

async function start() {
  const env = loadEnv();
  const app = await buildApp();

  await waitForDependencies(env);

  try {
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
    app.log.info(`SignalForge API listening on port ${env.API_PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info(`Received ${signal}, shutting down gracefully`);

      const forceTimer = setTimeout(() => {
        app.log.error('Shutdown timeout exceeded, forcing exit');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceTimer.unref();

      app.close().then(() => process.exit(0)).catch(() => process.exit(1));
    });
  }
}

void start();
