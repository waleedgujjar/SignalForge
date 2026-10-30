import { createQueue, createRedisConnection, type Queue } from '@signalforge/queue';
import { loadEnv } from '@signalforge/config';

/**
 * Long-lived BullMQ Queue registry for the API process.
 *
 * BullMQ opens a dedicated Redis connection for every `new Queue(...)`. The
 * routes used to create a fresh Queue on each request and never close it, so
 * Redis connections grew without bound; after enough imports/enqueues the
 * connections saturated and enqueue commands (which use `maxRetriesPerRequest:
 * null`, i.e. retry forever) hung, surfacing to the browser as a request
 * timeout. Reusing one Queue per name keeps the connection count bounded and
 * constant for the life of the process.
 */
const registry = new Map<string, Queue<unknown>>();

export function getQueue<T = unknown>(name: string): Queue<T> {
  const existing = registry.get(name);
  if (existing) return existing as Queue<T>;

  const env = loadEnv();
  const queue = createQueue<T>(name, createRedisConnection(env.REDIS_URL)) as Queue<unknown>;
  registry.set(name, queue);
  return queue as Queue<T>;
}

/** Close every shared queue (and its Redis connection). Wired to the app's onClose hook. */
export async function closeAllQueues(): Promise<void> {
  const queues = [...registry.values()];
  registry.clear();
  await Promise.all(queues.map((queue) => queue.close().catch(() => undefined)));
}

/** Test helper: drop cached queues so each suite starts clean. */
export function resetQueueRegistry(): void {
  registry.clear();
}
