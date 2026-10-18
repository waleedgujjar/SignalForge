import type { ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';

let cachedConnection: ConnectionOptions | null = null;

export function createRedisConnection(redisUrl: string): ConnectionOptions {
  if (cachedConnection) {
    return cachedConnection;
  }

  cachedConnection = {
    url: redisUrl,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };

  return cachedConnection;
}

export async function checkRedisConnection(
  redisUrl: string,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    lazyConnect: true,
  });

  try {
    await connection.connect();
    const pong = await connection.ping();
    await connection.quit();

    if (pong !== 'PONG') {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: `Unexpected Redis response: ${pong}`,
      };
    }

    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    try {
      await connection.quit();
    } catch {
      // ignore cleanup errors
    }

    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown Redis error',
    };
  }
}

export function resetRedisConnectionCache(): void {
  cachedConnection = null;
}

export type { ConnectionOptions as RedisConnectionOptions };
