import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockFindUnique = vi.fn();
const mockFindFirst = vi.fn();
const mockVerifyAndPersist = vi.fn();
const mockIncrementCounter = vi.fn();

vi.mock('@signalforge/database', () => ({
  prisma: {
    emailVerificationJob: { findUnique: mockFindUnique },
    lead: { findFirst: mockFindFirst },
  },
}));

vi.mock('@signalforge/verification', () => ({
  emailVerificationService: { verifyAndPersist: mockVerifyAndPersist },
  verificationJobService: { incrementCounter: mockIncrementCounter },
}));

describe('processEmailVerificationJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips cancelled jobs', async () => {
    mockFindUnique.mockResolvedValue({ id: 'job-1', status: 'CANCELLED' });
    const { processEmailVerificationJob } = await import('./processor.js');
    const result = await processEmailVerificationJob({
      jobId: 'job-1',
      workspaceId: 'ws-1',
      email: 'user@example.com',
    });
    expect(result).toEqual({ skipped: true });
    expect(mockVerifyAndPersist).not.toHaveBeenCalled();
  });

  it('verifies and increments counters for running jobs', async () => {
    mockFindUnique.mockResolvedValue({ id: 'job-1', status: 'RUNNING' });
    mockFindFirst.mockResolvedValue({ id: 'lead-1' });
    mockVerifyAndPersist.mockResolvedValue({ status: 'VERIFIED' });

    const { processEmailVerificationJob } = await import('./processor.js');
    const result = await processEmailVerificationJob({
      jobId: 'job-1',
      workspaceId: 'ws-1',
      email: 'user@example.com',
    });

    expect(result).toEqual({ status: 'VERIFIED', email: 'user@example.com' });
    expect(mockIncrementCounter).toHaveBeenCalledWith('job-1', 'VERIFIED');
  });
});
