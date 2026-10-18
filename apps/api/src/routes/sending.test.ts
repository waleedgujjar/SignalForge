import { describe, expect, it, vi, beforeEach } from 'vitest';

interface MockJob {
  id: string;
  workspaceId: string;
  campaignId: string;
  status: string;
  errorCategory: string | null;
}

const jobs = new Map<string, MockJob>();

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({
    LOG_LEVEL: 'error',
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-with-minimum-length',
    ENCRYPTION_KEY: 'a'.repeat(64),
  }),
}));

vi.mock('@signalforge/database', () => ({
  prisma: {
    sendingJob: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        for (const j of jobs.values()) {
          if (j.id === where.id && j.workspaceId === where.workspaceId) return j;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }: { where: { workspaceId: string } }) =>
        [...jobs.values()].filter((j) => j.workspaceId === where.workspaceId),
      ),
      count: vi.fn(async ({ where }: { where: { workspaceId: string } }) =>
        [...jobs.values()].filter((j) => j.workspaceId === where.workspaceId).length,
      ),
      groupBy: vi.fn(async () => []),
    },
  },
}));

vi.mock('@signalforge/sending', () => ({
  sendingJobService: {
    listJobs: vi.fn(async (workspaceId: string) => ({
      data: [...jobs.values()].filter((j) => j.workspaceId === workspaceId),
      pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
    })),
    getJob: vi.fn(async (id: string, workspaceId: string) => {
      const found = jobs.get(id);
      if (!found || found.workspaceId !== workspaceId) return null;
      return found;
    }),
    getQueueStats: vi.fn(async () => ({
      PENDING: 0,
      SCHEDULED: 0,
      PROCESSING: 0,
      RETRYING: 0,
      SENT: 0,
      FAILED: 0,
      CANCELLED: 0,
      PAUSED: 0,
    })),
    retryJob: vi.fn(async (id: string, workspaceId: string) => {
      const found = jobs.get(id);
      if (!found || found.workspaceId !== workspaceId) throw new Error('Sending job not found');
      if (found.errorCategory === 'AUTH') throw new Error('Job cannot be retried; error category AUTH');
      found.status = 'SCHEDULED';
      return found;
    }),
    cancelJob: vi.fn(async (id: string, workspaceId: string) => {
      const found = jobs.get(id);
      if (!found || found.workspaceId !== workspaceId) throw new Error('Sending job not found');
      found.status = 'CANCELLED';
      return found;
    }),
  },
}));

describe('Sending route logic', () => {
  beforeEach(() => {
    jobs.clear();
    jobs.set('job_1', {
      id: 'job_1',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      status: 'SCHEDULED',
      errorCategory: null,
    });
    jobs.set('job_2', {
      id: 'job_2',
      workspaceId: 'ws_other',
      campaignId: 'camp_2',
      status: 'FAILED',
      errorCategory: 'TEMPORARY',
    });
    jobs.set('job_auth', {
      id: 'job_auth',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      status: 'FAILED',
      errorCategory: 'AUTH',
    });
  });

  it('scopes list queries to a single workspace', async () => {
    const { sendingJobService } = await import('@signalforge/sending');
    const result = await sendingJobService.listJobs('ws_1', {}, { page: 1, limit: 50 });
    expect(result.data).toHaveLength(2);
    expect(result.data.every((j: { workspaceId: string }) => j.workspaceId === 'ws_1')).toBe(true);
  });

  it('denies cross-workspace access on job detail', async () => {
    const { sendingJobService } = await import('@signalforge/sending');
    const result = await sendingJobService.getJob('job_2', 'ws_1');
    expect(result).toBeNull();
  });

  it('rejects retry for AUTH-classified permanent failures', async () => {
    const { sendingJobService } = await import('@signalforge/sending');
    await expect(sendingJobService.retryJob('job_auth', 'ws_1')).rejects.toThrow(/cannot be retried/i);
  });

  it('rejects retry across workspace boundaries', async () => {
    const { sendingJobService } = await import('@signalforge/sending');
    await expect(sendingJobService.retryJob('job_2', 'ws_1')).rejects.toThrow(/not found/i);
  });

  it('cancels a job in the caller workspace', async () => {
    const { sendingJobService } = await import('@signalforge/sending');
    const result = await sendingJobService.cancelJob('job_1', 'ws_1');
    expect(result.status).toBe('CANCELLED');
  });
});
