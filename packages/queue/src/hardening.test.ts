import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('bullmq', () => {
  const Worker = vi.fn().mockImplementation((_name: string, _processor: unknown, opts: Record<string, unknown>) => {
    return { opts, on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  });
  const Queue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  }));
  return { Worker, Queue };
});

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({ REDIS_URL: 'redis://localhost:6379' }),
}));

vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

const { createWorker, withJobTimeout } = await import('./bullmq.js');

describe('createWorker', () => {
  it('uses default concurrency of 5', () => {
    const worker = createWorker('test', async () => {}, {});
    expect((worker as unknown as { opts: { concurrency: number } }).opts.concurrency).toBe(5);
  });

  it('accepts custom concurrency', () => {
    const worker = createWorker('test', async () => {}, {}, { concurrency: 10 });
    expect((worker as unknown as { opts: { concurrency: number } }).opts.concurrency).toBe(10);
  });

  it('accepts custom lockDuration', () => {
    const worker = createWorker('test', async () => {}, {}, { lockDuration: 120_000 });
    expect((worker as unknown as { opts: { lockDuration: number } }).opts.lockDuration).toBe(120_000);
  });

  it('defaults maxStalledCount to 2', () => {
    const worker = createWorker('test', async () => {}, {});
    expect((worker as unknown as { opts: { maxStalledCount: number } }).opts.maxStalledCount).toBe(2);
  });

  it('defaults stalledInterval to 30s', () => {
    const worker = createWorker('test', async () => {}, {});
    expect((worker as unknown as { opts: { stalledInterval: number } }).opts.stalledInterval).toBe(30_000);
  });
});

describe('withJobTimeout', () => {
  it('resolves when the function completes within timeout', async () => {
    const result = await withJobTimeout(() => Promise.resolve('done'), 5000);
    expect(result).toBe('done');
  });

  it('rejects when the function exceeds timeout', async () => {
    await expect(
      withJobTimeout(() => new Promise((resolve) => setTimeout(resolve, 200)), 50),
    ).rejects.toThrow('Job timed out after 50ms');
  });

  it('propagates the original error when the function rejects', async () => {
    await expect(
      withJobTimeout(() => Promise.reject(new Error('original')), 5000),
    ).rejects.toThrow('original');
  });
});

describe('campaign enrollment deterministic jobId', () => {
  function enrollmentJobId(campaignId: string, leadIds: string[]): string {
    const sorted = [...leadIds].sort().join(',');
    const hash = createHash('sha256').update(sorted).digest('hex').slice(0, 12);
    return `campaign-enroll-${campaignId}-${hash}`;
  }

  it('produces the same jobId for the same inputs', () => {
    const id1 = enrollmentJobId('camp-1', ['lead-a', 'lead-b']);
    const id2 = enrollmentJobId('camp-1', ['lead-a', 'lead-b']);
    expect(id1).toBe(id2);
  });

  it('produces the same jobId regardless of lead order', () => {
    const id1 = enrollmentJobId('camp-1', ['lead-b', 'lead-a']);
    const id2 = enrollmentJobId('camp-1', ['lead-a', 'lead-b']);
    expect(id1).toBe(id2);
  });

  it('produces different jobIds for different campaigns', () => {
    const id1 = enrollmentJobId('camp-1', ['lead-a']);
    const id2 = enrollmentJobId('camp-2', ['lead-a']);
    expect(id1).not.toBe(id2);
  });

  it('produces different jobIds for different lead sets', () => {
    const id1 = enrollmentJobId('camp-1', ['lead-a']);
    const id2 = enrollmentJobId('camp-1', ['lead-b']);
    expect(id1).not.toBe(id2);
  });
});
