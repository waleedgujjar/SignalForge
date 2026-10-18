import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockJob {
  id: string;
  workspaceId: string;
  mailboxId: string;
  usageDate: Date;
  recipientEmail: string;
  renderedSubject: string;
  renderedBody: string;
  providerMessageId: string | null;
}

let mockJob: MockJob | null = null;
const claimJobMock = vi.fn<() => Promise<MockJob | null>>(async () => mockJob);
const markSentMock = vi.fn(async () => undefined);
const markFailedMock = vi.fn(async () => undefined);
const markDeferredMock = vi.fn(async () => undefined);

let mockEligibility: {
  eligible: boolean;
  reason: string;
  configuredLimit: number;
} = { eligible: true, reason: 'ELIGIBLE', configuredLimit: 10 };

const reserveMock = vi.fn(async () => ({ reservationId: 'res_1', reused: false }));
const consumeMock = vi.fn(async () => undefined);
const releaseMock = vi.fn(async () => undefined);
const recordSuccessMock = vi.fn(async () => undefined);
const recordFailureMock = vi.fn(async () => ({ blocked: false }));

class WarmupCapacityExhaustedError extends Error {
  constructor() {
    super('exhausted');
    this.name = 'WarmupCapacityExhaustedError';
  }
}
class WarmupReservationConflictError extends Error {
  constructor() {
    super('conflict');
    this.name = 'WarmupReservationConflictError';
  }
}

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({
    LOG_LEVEL: 'error',
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    SESSION_SECRET: 'a'.repeat(48),
    ENCRYPTION_KEY: 'a'.repeat(64),
    REDIS_URL: 'redis://localhost:6379',
  }),
}));

const sendMock = vi.fn(async () => ({ messageId: 'msg-1' }));

vi.mock('@signalforge/email', () => ({
  decryptSecret: vi.fn(() => 'plaintext-password'),
  createSmtpProvider: vi.fn(() => ({ send: sendMock })),
}));

vi.mock('@signalforge/sending', () => ({
  classifySendError: (err: unknown) => ({
    category: 'TEMPORARY',
    message: err instanceof Error ? err.message : 'error',
    retryable: true,
  }),
}));

vi.mock('@signalforge/warmup', () => ({
  computeUsageDate: () => '2026-01-05',
  toUsageDate: (d: string) => new Date(`${d}T00:00:00Z`),
  getWarmupEligibility: async () => mockEligibility,
  warmupJobService: {
    claimJob: claimJobMock,
    markSent: markSentMock,
    markFailed: markFailedMock,
    markDeferred: markDeferredMock,
  },
  warmupConfigService: {
    recordSuccess: recordSuccessMock,
    recordFailure: recordFailureMock,
  },
  reserveWarmupCapacity: reserveMock,
  consumeWarmupReservation: consumeMock,
  releaseWarmupReservation: releaseMock,
  logWarmupEvent: vi.fn(),
  WarmupCapacityExhaustedError,
  WarmupReservationConflictError,
}));

const mailboxUpdateMock = vi.fn(async () => undefined);
const mailboxHealthFindUnique = vi.fn(async () => null);
const mailboxHealthUpdate = vi.fn(async () => undefined);

vi.mock('@signalforge/database', () => ({
  prisma: {
    mailbox: {
      findFirst: vi.fn(async () => ({
        id: 'mb_1',
        workspaceId: 'ws_1',
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpUsername: 'sender@example.com',
        emailAddress: 'sender@example.com',
        fromName: 'Sender',
        encryptionType: 'SSL_TLS',
        healthStatus: 'HEALTHY',
        timezone: 'UTC',
        dailySendingLimit: 100,
        credential: { encryptedPayload: 'enc' },
        workspace: { timezone: 'UTC' },
      })),
      update: mailboxUpdateMock,
    },
    mailboxHealth: {
      findUnique: mailboxHealthFindUnique,
      update: mailboxHealthUpdate,
    },
    warmupDailyHistory: {
      upsert: vi.fn(async () => undefined),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        mailbox: { update: mailboxUpdateMock },
        mailboxHealth: {
          findUnique: mailboxHealthFindUnique,
          update: mailboxHealthUpdate,
        },
      }),
  },
}));

beforeEach(() => {
  mockJob = {
    id: 'wj_1',
    workspaceId: 'ws_1',
    mailboxId: 'mb_1',
    usageDate: new Date('2026-01-05T00:00:00Z'),
    recipientEmail: 'friend@example.com',
    renderedSubject: 'Hello',
    renderedBody: 'Body',
    providerMessageId: null,
  };
  mockEligibility = { eligible: true, reason: 'ELIGIBLE', configuredLimit: 10 };
  claimJobMock.mockClear();
  markSentMock.mockClear();
  markFailedMock.mockClear();
  markDeferredMock.mockClear();
  reserveMock.mockClear();
  consumeMock.mockClear();
  releaseMock.mockClear();
  recordSuccessMock.mockClear();
  recordFailureMock.mockClear();
  sendMock.mockClear();
  sendMock.mockImplementation(async () => ({ messageId: 'msg-1' }));
  reserveMock.mockImplementation(async () => ({ reservationId: 'res_1', reused: false }));
});

describe('processWarmupSendJob', () => {
  it('returns JOB_NOT_CLAIMABLE when the job cannot be claimed', async () => {
    mockJob = null;
    const { processWarmupSendJob } = await import('./pipeline.js');
    const result = await processWarmupSendJob({
      warmupJobId: 'wj_1',
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('JOB_NOT_CLAIMABLE');
  });

  it('defers the job when eligibility says no recipients configured', async () => {
    mockEligibility = {
      eligible: false,
      reason: 'NO_WARMUP_RECIPIENTS',
      configuredLimit: 0,
    };
    const { processWarmupSendJob } = await import('./pipeline.js');
    const result = await processWarmupSendJob({
      warmupJobId: 'wj_1',
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
    });
    expect(result.ok).toBe(false);
    expect(markDeferredMock).toHaveBeenCalled();
    if (!result.ok) {
      expect(result.reason).toBe('NO_WARMUP_RECIPIENTS');
      expect(result.deferred).toBe(true);
    }
  });

  it('reserves, sends, and consumes on a successful send', async () => {
    const { processWarmupSendJob } = await import('./pipeline.js');
    const result = await processWarmupSendJob({
      warmupJobId: 'wj_1',
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
    });
    expect(result.ok).toBe(true);
    expect(reserveMock).toHaveBeenCalledOnce();
    expect(consumeMock).toHaveBeenCalledOnce();
    expect(markSentMock).toHaveBeenCalledOnce();
    expect(recordSuccessMock).toHaveBeenCalledOnce();
  });

  it('defers the job when warmup capacity is exhausted', async () => {
    reserveMock.mockImplementation(async () => {
      throw new WarmupCapacityExhaustedError();
    });
    const { processWarmupSendJob } = await import('./pipeline.js');
    const result = await processWarmupSendJob({
      warmupJobId: 'wj_1',
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('CAPACITY_EXHAUSTED');
      expect(result.deferred).toBe(true);
    }
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('releases the reservation and marks failed when SMTP send throws', async () => {
    sendMock.mockImplementation(async () => {
      throw new Error('smtp down');
    });
    const { processWarmupSendJob } = await import('./pipeline.js');
    const result = await processWarmupSendJob({
      warmupJobId: 'wj_1',
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
    });
    expect(result.ok).toBe(false);
    expect(releaseMock).toHaveBeenCalledOnce();
    expect(markFailedMock).toHaveBeenCalledOnce();
    expect(recordFailureMock).toHaveBeenCalledOnce();
  });
});
