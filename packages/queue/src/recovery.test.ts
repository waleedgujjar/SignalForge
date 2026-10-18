import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@signalforge/database', () => ({
  prisma: {
    leadDiscoveryJob: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    emailVerificationJob: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from '@signalforge/database';
import { recoverStuckDiscoveryJobs, recoverStuckVerificationJobs } from './recovery.js';

const discoveryFindMany = prisma.leadDiscoveryJob.findMany as ReturnType<typeof vi.fn>;
const discoveryUpdateMany = prisma.leadDiscoveryJob.updateMany as ReturnType<typeof vi.fn>;
const verificationFindMany = prisma.emailVerificationJob.findMany as ReturnType<typeof vi.fn>;
const verificationUpdateMany = prisma.emailVerificationJob.updateMany as ReturnType<typeof vi.fn>;

describe('recoverStuckDiscoveryJobs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 0 when no stuck jobs found', async () => {
    discoveryFindMany.mockResolvedValue([]);
    const count = await recoverStuckDiscoveryJobs();
    expect(count).toBe(0);
    expect(discoveryUpdateMany).not.toHaveBeenCalled();
  });

  it('marks stuck RUNNING jobs as FAILED', async () => {
    discoveryFindMany.mockResolvedValue([{ id: 'j1' }, { id: 'j2' }]);
    discoveryUpdateMany.mockResolvedValue({ count: 2 });

    const count = await recoverStuckDiscoveryJobs();
    expect(count).toBe(2);
    expect(discoveryUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['j1', 'j2'] }, status: 'RUNNING' },
      data: { status: 'FAILED', error: 'Recovered: stuck in RUNNING state' },
    });
  });

  it('uses the provided time for threshold calculation', async () => {
    discoveryFindMany.mockResolvedValue([]);
    const now = new Date('2026-01-01T12:00:00Z');
    await recoverStuckDiscoveryJobs(now);

    const call = discoveryFindMany.mock.calls[0]![0] as { where: { updatedAt: { lt: Date } } };
    const threshold = call.where.updatedAt.lt;
    expect(threshold.getTime()).toBe(now.getTime() - 10 * 60 * 1000);
  });
});

describe('recoverStuckVerificationJobs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 0 when no stuck jobs found', async () => {
    verificationFindMany.mockResolvedValue([]);
    const count = await recoverStuckVerificationJobs();
    expect(count).toBe(0);
    expect(verificationUpdateMany).not.toHaveBeenCalled();
  });

  it('marks stuck verification jobs as FAILED', async () => {
    verificationFindMany.mockResolvedValue([{ id: 'v1' }]);
    verificationUpdateMany.mockResolvedValue({ count: 1 });

    const count = await recoverStuckVerificationJobs();
    expect(count).toBe(1);
    expect(verificationUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['v1'] }, status: 'RUNNING' },
      data: { status: 'FAILED', error: 'Recovered: stuck in RUNNING state' },
    });
  });
});
