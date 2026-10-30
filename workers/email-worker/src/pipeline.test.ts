import { describe, expect, it, vi, beforeEach } from 'vitest';
import { prisma } from '@signalforge/database';

interface MockJob {
  id: string;
  attempts: number;
  maxAttempts: number;
  status: string;
  providerMessageId: string | null;
  workspaceId: string;
  campaignId: string;
  campaignLeadId: string;
  leadId: string;
  sequenceStepId: string;
  mailboxId: string | null;
  scheduledAt: Date;
}

let mockJob: MockJob;
const rescheduleForWindowMock = vi.fn(async () => mockJob);
const markSentMock = vi.fn(async () => mockJob);
const markFailedMock = vi.fn(async () => mockJob);
const rescheduleForRetryMock = vi.fn(async () => mockJob);
const scheduleNextStepMock = vi.fn(async () => null);
const stopCampaignLeadSequenceMock = vi.fn(async () => undefined);
const cancelJobMock = vi.fn(async () => undefined);
const claimJobMock = vi.fn<() => Promise<MockJob | null>>(async () => mockJob);

interface AllocationResult {
  status: 'ALLOCATED' | 'IDEMPOTENT' | 'FAILED';
  mailboxId?: string;
  reservationId?: string;
  outcome?: string;
  reason?: string;
  retryable?: boolean;
  strategy?: string;
  poolId?: string | null;
}

const allocateAccountMock = vi.fn<() => Promise<AllocationResult>>(async () => ({
  status: 'FAILED',
  outcome: 'NO_ELIGIBLE_ACCOUNTS',
  reason: 'No eligible accounts',
  retryable: true,
}));
const consumeReservationMock = vi.fn(async () => undefined);
const releaseReservationMock = vi.fn(async () => undefined);

interface GateResult {
  allowed: boolean;
  reason: string | null;
  message: string | null;
}

const checkEligibilityMock = vi.fn(async () => ({
  eligible: true,
  reason: 'ELIGIBLE',
  message: 'Lead is eligible for sending.',
}));
const checkMailboxGateMock = vi.fn<() => Promise<GateResult>>(async () => ({
  allowed: true,
  reason: null,
  message: null,
}));
interface DeliveryEventInput {
  workspaceId: string;
  eventType: string;
  idempotencyKey: string;
  mailboxId?: string | null;
}

const recordDeliveryEventMock = vi.fn(async (_input: DeliveryEventInput) => ({
  id: 'event_1',
  created: true,
}));
const recordBounceMock = vi.fn(async () => ({
  status: 'ACTIVE',
  softBounceCount: 0,
  hardBounceCount: 0,
  shouldSuppress: false,
}));
const evaluateMailboxMock = vi.fn(async () => null);
const leadUpdateManyMock = vi.fn(async (_args: unknown) => ({ count: 1 }));

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

vi.mock('@signalforge/database', () => ({
  prisma: {
    campaign: {
      findFirst: vi.fn(async () => ({
        id: 'camp_1',
        status: 'ACTIVE',
        rotationStrategy: 'HEALTH_AWARE',
        scheduleConfig: {
          timezone: 'UTC',
          days: [0, 1, 2, 3, 4, 5, 6],
          startTime: '00:00',
          endTime: '23:59',
        },
        workspace: { timezone: 'UTC' },
      })),
    },
    campaignLead: {
      findFirst: vi.fn(async () => ({ id: 'cl_1', status: 'ACTIVE' })),
      findUnique: vi.fn(async () => ({
        id: 'cl_1',
        status: 'ACTIVE',
        repliedAt: null,
        stopReason: null,
        lead: { status: 'NEW' },
      })),
    },
    campaignStep: {
      findFirst: vi.fn(async () => ({
        id: 'step_1',
        campaignId: 'camp_1',
        subjectTemplate: 'Hi',
        bodyTemplate: 'Body',
        order: 0,
      })),
    },
    lead: {
      findFirst: vi.fn(async () => ({
        id: 'lead_1',
        email: 'lead@example.com',
        status: 'NEW',
        verification: null,
        enrichment: {
          icpFitScore: 85,
          prospectScore: 72,
          department: 'Engineering',
          seniority: 'Senior',
          dynamicVariables: {
            pain_point: 'Manual processes',
            recommended_service: 'Automation suite',
          },
        },
        websiteAnalyses: [{ websiteScore: 68, createdAt: new Date() }],
        research: [
          {
            structuredData: {
              company: {
                description: 'Cloud platform provider',
                services: ['Hosting', 'DNS'],
                serviceArea: 'North America',
                specializations: ['Edge computing'],
              },
            },
          },
        ],
      })),
    },
    suppression: { findMany: vi.fn(async () => []) },
    workspaceVerificationPolicy: { findFirst: vi.fn(async () => null) },
    emailMessage: { create: vi.fn(async () => ({ id: 'msg_1' })) },
    mailbox: {
      findUnique: vi.fn(async () => ({
        id: 'mb_1',
        emailAddress: 'a@b.com',
        fromName: 'A',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUsername: 'a@b.com',
        encryptionType: 'TLS',
        credential: { encryptedPayload: 'enc', keyVersion: 1 },
      })),
      update: vi.fn(async () => undefined),
    },
    mailboxHealth: {
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => undefined),
    },
    sendingJob: { update: vi.fn(async () => undefined) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        emailMessage: { create: vi.fn(async () => ({ id: 'msg_1' })) },
        mailbox: { update: vi.fn(async () => undefined) },
        mailboxHealth: {
          findUnique: vi.fn(async () => null),
          update: vi.fn(async () => undefined),
        },
        lead: { updateMany: leadUpdateManyMock },
      }),
    ),
  },
}));

vi.mock('@signalforge/email', () => ({
  decryptSecret: () => 'password',
  createSmtpProvider: () => ({ send: async () => ({ messageId: 'smtp-1' }) }),
  evaluateSendingPolicy: () => ({ decision: 'ALLOW_SEND', renderedSubject: 'Hi', renderedBody: 'Body' }),
  leadToVariableContext: () => ({}),
  buildUnsubscribeUrl: () => 'https://api.test/unsubscribe?token=test',
  buildTrackingPixelUrl: () => 'https://api.test/tracking/open.gif?t=test',
}));

vi.mock('@signalforge/allocation', () => ({
  allocationService: {
    allocateAccount: allocateAccountMock,
  },
  consumeReservation: consumeReservationMock,
  releaseReservation: releaseReservationMock,
}));

vi.mock('@signalforge/sending', () => ({
  calculateNextValidSlot: (now: Date) => new Date(now.getTime() + 3600 * 1000),
  classifySendError: (error: unknown) => ({
    category: 'CONNECTION',
    retryable: true,
    message: error instanceof Error ? error.message : String(error),
  }),
  isWithinSendingWindow: () => true,
  retryBackoffMs: () => 1000,
  logSendingEvent: () => undefined,
  sendingJobService: {
    claimJob: claimJobMock,
    rescheduleForWindow: rescheduleForWindowMock,
    markSent: markSentMock,
    markFailed: markFailedMock,
    rescheduleForRetry: rescheduleForRetryMock,
    scheduleNextStep: scheduleNextStepMock,
    stopCampaignLeadSequence: stopCampaignLeadSequenceMock,
    cancelJob: cancelJobMock,
  },
  sendingEligibilityService: {
    check: checkEligibilityMock,
  },
  sendingLimitService: {
    checkCampaignDailyLimit: vi.fn(async () => ({ exhausted: false })),
    incrementCampaignDailyUsage: vi.fn(async () => undefined),
  },
}));

vi.mock('@signalforge/automations', () => ({
  publishWorkflowEvent: vi.fn(async () => 'event_1'),
}));

vi.mock('@signalforge/deliverability', () => ({
  buildIdempotencyKey: (parts: unknown[]) => parts.join('|'),
  classifyBounceFromCategory: () => ({
    bounceType: null,
    isBounce: false,
    reason: 'Not a bounce.',
    statusCode: null,
    enhancedStatusCode: null,
    response: 'connection error',
  }),
  deliverabilityProtectionService: { evaluateMailbox: evaluateMailboxMock },
  deliverabilitySendGate: { checkMailbox: checkMailboxGateMock },
  deliveryEventService: { recordEvent: recordDeliveryEventMock },
  recipientBounceService: { recordBounce: recordBounceMock },
}));

beforeEach(() => {
  mockJob = {
    id: 'job_1',
    attempts: 1,
    maxAttempts: 3,
    status: 'PROCESSING',
    providerMessageId: null,
    workspaceId: 'ws_1',
    campaignId: 'camp_1',
    campaignLeadId: 'cl_1',
    leadId: 'lead_1',
    sequenceStepId: 'step_1',
    mailboxId: null,
    scheduledAt: new Date(),
  };
  rescheduleForWindowMock.mockClear();
  markSentMock.mockClear();
  markFailedMock.mockClear();
  rescheduleForRetryMock.mockClear();
  scheduleNextStepMock.mockClear();
  claimJobMock.mockClear();
  claimJobMock.mockImplementation(async () => mockJob);
  allocateAccountMock.mockClear();
  allocateAccountMock.mockImplementation(async () => ({
    status: 'FAILED',
    outcome: 'NO_ELIGIBLE_ACCOUNTS',
    reason: 'No eligible accounts',
    retryable: true,
  }));
  consumeReservationMock.mockClear();
  releaseReservationMock.mockClear();
  checkEligibilityMock.mockClear();
  recordDeliveryEventMock.mockClear();
  recordBounceMock.mockClear();
  evaluateMailboxMock.mockClear();
  leadUpdateManyMock.mockClear();
  checkMailboxGateMock.mockClear();
  checkMailboxGateMock.mockImplementation(async () => ({
    allowed: true,
    reason: null,
    message: null,
  }));
});

describe('processEmailSendJob', () => {
  it('returns not-claimable when the job cannot be claimed', async () => {
    claimJobMock.mockImplementationOnce(async () => null);
    const { processEmailSendJob } = await import('./pipeline.js');
    const result = await processEmailSendJob({
      sendingJobId: 'job_1',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      campaignLeadId: 'cl_1',
      leadId: 'lead_1',
      stepId: 'step_1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('JOB_NOT_CLAIMABLE');
    }
  });

  it('is idempotent when providerMessageId is already set', async () => {
    mockJob.providerMessageId = 'smtp-1';
    const { processEmailSendJob } = await import('./pipeline.js');
    const result = await processEmailSendJob({
      sendingJobId: 'job_1',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      campaignLeadId: 'cl_1',
      leadId: 'lead_1',
      stepId: 'step_1',
    });
    expect(result.ok).toBe(true);
    expect(markSentMock).not.toHaveBeenCalled();
    expect(allocateAccountMock).not.toHaveBeenCalled();
  });

  it('defers when allocation returns NO_ELIGIBLE_ACCOUNTS', async () => {
    const { processEmailSendJob } = await import('./pipeline.js');
    const result = await processEmailSendJob({
      sendingJobId: 'job_1',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      campaignLeadId: 'cl_1',
      leadId: 'lead_1',
      stepId: 'step_1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('NO_ELIGIBLE_ACCOUNTS');
      expect(result.deferred).toBe(true);
    }
    expect(rescheduleForWindowMock).toHaveBeenCalled();
    expect(consumeReservationMock).not.toHaveBeenCalled();
  });

  it('consumes reservation on successful send', async () => {
    allocateAccountMock.mockImplementationOnce(async () => ({
      status: 'ALLOCATED',
      mailboxId: 'mb_1',
      reservationId: 'res_1',
      strategy: 'ROUND_ROBIN',
      poolId: null,
    }));
    const { processEmailSendJob } = await import('./pipeline.js');
    const result = await processEmailSendJob({
      sendingJobId: 'job_1',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      campaignLeadId: 'cl_1',
      leadId: 'lead_1',
      stepId: 'step_1',
    });
    expect(result.ok).toBe(true);
    expect(consumeReservationMock).toHaveBeenCalledWith({ reservationId: 'res_1' });
    expect(markSentMock).toHaveBeenCalled();
  });

  it('records exactly one SENT delivery event per successful send', async () => {
    allocateAccountMock.mockImplementationOnce(async () => ({
      status: 'ALLOCATED',
      mailboxId: 'mb_1',
      reservationId: 'res_1',
      strategy: 'ROUND_ROBIN',
      poolId: null,
    }));
    const { processEmailSendJob } = await import('./pipeline.js');
    await processEmailSendJob({
      sendingJobId: 'job_1',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      campaignLeadId: 'cl_1',
      leadId: 'lead_1',
      stepId: 'step_1',
    });

    expect(recordDeliveryEventMock).toHaveBeenCalledTimes(1);
    expect(recordDeliveryEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'SENT', workspaceId: 'ws_1', mailboxId: 'mb_1' }),
    );
  });

  it('keys the SENT event on the job attempt so a retried job cannot double-count', async () => {
    allocateAccountMock.mockImplementation(async () => ({
      status: 'ALLOCATED',
      mailboxId: 'mb_1',
      reservationId: 'res_1',
      strategy: 'ROUND_ROBIN',
      poolId: null,
    }));
    const { processEmailSendJob } = await import('./pipeline.js');
    const payload = {
      sendingJobId: 'job_1',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      campaignLeadId: 'cl_1',
      leadId: 'lead_1',
      stepId: 'step_1',
    };

    await processEmailSendJob(payload);
    await processEmailSendJob(payload);

    const keys = recordDeliveryEventMock.mock.calls.map(([input]) => input.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('marks the lead CONTACTED in the same transaction as the send', async () => {
    allocateAccountMock.mockImplementationOnce(async () => ({
      status: 'ALLOCATED',
      mailboxId: 'mb_1',
      reservationId: 'res_1',
      strategy: 'ROUND_ROBIN',
      poolId: null,
    }));
    const { processEmailSendJob } = await import('./pipeline.js');
    await processEmailSendJob({
      sendingJobId: 'job_1',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      campaignLeadId: 'cl_1',
      leadId: 'lead_1',
      stepId: 'step_1',
    });

    // Scoped to NEW and to the workspace so a later step cannot downgrade a
    // lead that has already replied or been qualified.
    expect(leadUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'lead_1', workspaceId: 'ws_1', status: 'NEW' },
      data: { status: 'CONTACTED' },
    });
  });

  it('loads enrichment and research data when querying the lead', async () => {
    allocateAccountMock.mockImplementationOnce(async () => ({
      status: 'ALLOCATED',
      mailboxId: 'mb_1',
      reservationId: 'res_1',
      strategy: 'ROUND_ROBIN',
      poolId: null,
    }));
    const { processEmailSendJob } = await import('./pipeline.js');
    await processEmailSendJob({
      sendingJobId: 'job_1',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      campaignLeadId: 'cl_1',
      leadId: 'lead_1',
      stepId: 'step_1',
    });

    const findFirstCall = vi.mocked(prisma.lead.findFirst).mock.calls[0]?.[0];
    expect(findFirstCall).toBeDefined();
    const include = (findFirstCall as Record<string, unknown>).include as Record<string, unknown>;
    expect(include.enrichment).toBe(true);
    expect(include.websiteAnalyses).toBeDefined();
    expect(include.research).toBeDefined();
  });

  it('does not touch lead status when the send never happens', async () => {
    const { processEmailSendJob } = await import('./pipeline.js');
    await processEmailSendJob({
      sendingJobId: 'job_1',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      campaignLeadId: 'cl_1',
      leadId: 'lead_1',
      stepId: 'step_1',
    });

    expect(leadUpdateManyMock).not.toHaveBeenCalled();
  });

  it('defers the job and releases the reservation when the mailbox is under protection', async () => {
    allocateAccountMock.mockImplementationOnce(async () => ({
      status: 'ALLOCATED',
      mailboxId: 'mb_1',
      reservationId: 'res_1',
      strategy: 'ROUND_ROBIN',
      poolId: null,
    }));
    checkMailboxGateMock.mockImplementationOnce(async () => ({
      allowed: false,
      reason: 'MAILBOX_CRITICAL_HEALTH',
      message: 'Mailbox health is critical.',
    }));

    const { processEmailSendJob } = await import('./pipeline.js');
    const result = await processEmailSendJob({
      sendingJobId: 'job_1',
      workspaceId: 'ws_1',
      campaignId: 'camp_1',
      campaignLeadId: 'cl_1',
      leadId: 'lead_1',
      stepId: 'step_1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('MAILBOX_CRITICAL_HEALTH');
      expect(result.deferred).toBe(true);
    }
    expect(releaseReservationMock).toHaveBeenCalledWith({
      reservationId: 'res_1',
      reason: 'MAILBOX_CRITICAL_HEALTH',
    });
    expect(markSentMock).not.toHaveBeenCalled();
    expect(markFailedMock).not.toHaveBeenCalled();
  });
});
