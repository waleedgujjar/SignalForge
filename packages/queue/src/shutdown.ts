import type { Worker } from 'bullmq';

export interface GracefulShutdownOptions {
  timeoutMs?: number;
  onShutdown?: () => void | Promise<void>;
}

const SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

export function registerWorkerShutdown(
  worker: Worker | Worker[],
  options: GracefulShutdownOptions = {},
): () => Promise<void> {
  const workers = Array.isArray(worker) ? worker : [worker];
  const timeoutMs = options.timeoutMs ?? 30_000;
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    const timer = setTimeout(() => {
      console.error(`Worker shutdown exceeded ${timeoutMs}ms, forcing exit`);
      process.exit(1);
    }, timeoutMs);
    timer.unref();

    try {
      if (options.onShutdown) {
        await options.onShutdown();
      }
      await Promise.all(workers.map((w) => w.close()));
    } catch (error) {
      console.error('Error during worker shutdown', error);
    } finally {
      clearTimeout(timer);
    }
  };

  for (const signal of SIGNALS) {
    process.once(signal, () => {
      console.info(`Received ${signal}, closing workers gracefully`);
      void shutdown().finally(() => process.exit(0));
    });
  }

  return shutdown;
}
