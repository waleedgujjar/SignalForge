import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Worker } from 'bullmq';
import { registerWorkerShutdown } from './shutdown.js';

function createMockWorker(): Pick<Worker, 'close'> {
  return { close: vi.fn().mockResolvedValue(undefined) as Worker['close'] };
}

describe('registerWorkerShutdown', () => {
  const originalListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      originalListeners[sig] = process.listeners(sig) as ((...args: unknown[]) => void)[];
    }
  });

  afterEach(() => {
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      process.removeAllListeners(sig);
      for (const fn of originalListeners[sig]!) {
        process.on(sig, fn);
      }
    }
  });

  it('returns a shutdown function', () => {
    const shutdown = registerWorkerShutdown(createMockWorker() as unknown as Worker);
    expect(typeof shutdown).toBe('function');
  });

  it('closes a single worker on shutdown', async () => {
    const worker = createMockWorker();
    const shutdown = registerWorkerShutdown(worker as unknown as Worker);
    await shutdown();
    expect(worker.close).toHaveBeenCalledOnce();
  });

  it('closes multiple workers on shutdown', async () => {
    const w1 = createMockWorker();
    const w2 = createMockWorker();
    const shutdown = registerWorkerShutdown([w1, w2] as unknown as Worker[]);
    await shutdown();
    expect(w1.close).toHaveBeenCalledOnce();
    expect(w2.close).toHaveBeenCalledOnce();
  });

  it('calls onShutdown callback before closing workers', async () => {
    const order: string[] = [];
    const worker = createMockWorker();
    (worker.close as ReturnType<typeof vi.fn>).mockImplementation(async () => { order.push('close'); });
    const onShutdown = vi.fn(async () => { order.push('onShutdown'); });

    const shutdown = registerWorkerShutdown(worker as unknown as Worker, { onShutdown });
    await shutdown();

    expect(order).toEqual(['onShutdown', 'close']);
  });

  it('is idempotent — second call is a no-op', async () => {
    const worker = createMockWorker();
    const shutdown = registerWorkerShutdown(worker as unknown as Worker);
    await shutdown();
    await shutdown();
    expect(worker.close).toHaveBeenCalledOnce();
  });

  it('registers signal handlers for SIGTERM and SIGINT', () => {
    const worker = createMockWorker();
    const sigTermBefore = process.listenerCount('SIGTERM');
    const sigIntBefore = process.listenerCount('SIGINT');

    registerWorkerShutdown(worker as unknown as Worker);

    expect(process.listenerCount('SIGTERM')).toBe(sigTermBefore + 1);
    expect(process.listenerCount('SIGINT')).toBe(sigIntBefore + 1);
  });

  it('handles worker.close errors without throwing', async () => {
    const worker = createMockWorker();
    (worker.close as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('close failed'));
    const shutdown = registerWorkerShutdown(worker as unknown as Worker);

    await expect(shutdown()).resolves.toBeUndefined();
  });
});
