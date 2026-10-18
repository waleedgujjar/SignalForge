import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SendingJob } from '@signalforge/database';

const campaignLeadUpdateMock = vi.fn(async (args: unknown) => ({ id: 'cl_1', ...(args as object) }));
const campaignLeadFindUniqueMock = vi.fn(async () => ({
  id: 'cl_1',
  status: 'ACTIVE',
  campaignId: 'camp_1',
  leadId: 'lead_1',
}));
const leadFindUniqueMock = vi.fn(async () => ({
  id: 'lead_1',
  status: 'NEW',
}));
const campaignFindUniqueMock = vi.fn(async () => ({
  id: 'camp_1',
  followUpsEnabled: false,
  maxFollowUps: 5,
  scheduleConfig: { timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], startTime: '00:00', endTime: '23:59' },
  steps: [
    {
      id: 'step_0',
      order: 0,
      enabled: true,
      delayAmount: 0,
      delayUnit: 'DAYS',
      subjectTemplate: 'Initial',
      bodyTemplate: 'Body 0',
    },
    {
      id: 'step_1',
      order: 1,
      enabled: true,
      delayAmount: 2,
      delayUnit: 'DAYS',
      subjectTemplate: 'Follow-up 1',
      bodyTemplate: 'Body 1',
    },
  ],
}));
const sendingJobUpsertMock = vi.fn(async (args: { create: Record<string, unknown> }) => ({
  id: 'job_next',
  ...args.create,
  status: 'SCHEDULED',
}));
const sendingJobFindUniqueMock = vi.fn(async () => ({
  id: 'job_1',
  status: 'SCHEDULED',
  attempts: 0,
}));
const sendingJobUpdateMock = vi.fn(async (args: { data: Record<string, unknown> }) => ({
  id: 'job_1',
  status: 'PROCESSING',
  ...args.data,
}));
const transactionMock = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    sendingJob: {
      findUnique: sendingJobFindUniqueMock,
      update: sendingJobUpdateMock,
    },
  }),
);

vi.mock('@signalforge/database', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.code = code;
      }
    },
  },
  prisma: {
    campaignLead: {
      findUnique: campaignLeadFindUniqueMock,
      findFirst: vi.fn(async () => null),
      update: campaignLeadUpdateMock,
    },
    lead: { findUnique: leadFindUniqueMock },
    campaign: { findUnique: campaignFindUniqueMock },
    campaignStep: { findMany: vi.fn(async () => []) },
    sendingJob: {
      upsert: sendingJobUpsertMock,
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: transactionMock,
  },
}));

vi.mock('@signalforge/queue', () => ({
  publishWorkflowEvent: vi.fn(async () => 'evt_1'),
}));

vi.mock('./activity.js', () => ({
  logSendingEvent: vi.fn(),
}));

vi.mock('./schedule-calculator.js', () => ({
  calculateNextSendTime: () => ({
    scheduledAt: new Date('2026-09-05T12:00:00.000Z'),
  }),
}));

const baseJob = {
  id: 'job_1',
  workspaceId: 'ws_1',
  campaignId: 'camp_1',
  campaignLeadId: 'cl_1',
  leadId: 'lead_1',
  sequenceStepId: 'step_0',
  mailboxId: null,
  scheduledAt: new Date(),
  priority: 0,
  maxAttempts: 3,
  attempts: 1,
  status: 'SENT',
  claimedAt: null,
  sentAt: new Date(),
  cancelledAt: null,
  lastError: null,
  errorCategory: null,
  providerMessageId: null,
  emailMessageId: null,
  templateSubject: 'Initial',
  templateBody: 'Body 0',
  createdAt: new Date(),
  updatedAt: new Date(),
} as SendingJob;

beforeEach(() => {
  campaignLeadUpdateMock.mockClear();
  campaignFindUniqueMock.mockClear();
  sendingJobUpsertMock.mockClear();
  sendingJobFindUniqueMock.mockClear();
  sendingJobUpdateMock.mockClear();
  transactionMock.mockClear();
  campaignLeadFindUniqueMock.mockImplementation(async () => ({
    id: 'cl_1',
    status: 'ACTIVE',
    campaignId: 'camp_1',
    leadId: 'lead_1',
  }));
  leadFindUniqueMock.mockImplementation(async () => ({ id: 'lead_1', status: 'NEW' }));
  campaignFindUniqueMock.mockImplementation(async () => ({
    id: 'camp_1',
    followUpsEnabled: false,
    maxFollowUps: 5,
    scheduleConfig: { timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], startTime: '00:00', endTime: '23:59' },
    steps: [
      {
        id: 'step_0',
        order: 0,
        enabled: true,
        delayAmount: 0,
        delayUnit: 'DAYS',
        subjectTemplate: 'Initial',
        bodyTemplate: 'Body 0',
      },
      {
        id: 'step_1',
        order: 1,
        enabled: true,
        delayAmount: 2,
        delayUnit: 'DAYS',
        subjectTemplate: 'Follow-up 1',
        bodyTemplate: 'Body 1',
      },
    ],
  }));
  sendingJobFindUniqueMock.mockImplementation(async () => ({
    id: 'job_1',
    status: 'SCHEDULED',
    attempts: 0,
  }));
});

describe('SendingJobService.scheduleNextStep', () => {
  it('marks lead COMPLETED when follow-ups are disabled', async () => {
    const { SendingJobService } = await import('./job-service.js');
    const service = new SendingJobService();
    const result = await service.scheduleNextStep(baseJob);

    expect(result).toBeNull();
    expect(campaignLeadUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cl_1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          stopReason: 'COMPLETED',
        }),
      }),
    );
    expect(sendingJobUpsertMock).not.toHaveBeenCalled();
  });

  it('schedules the next follow-up with template snapshots when enabled', async () => {
    campaignFindUniqueMock.mockImplementationOnce(async () => ({
      id: 'camp_1',
      followUpsEnabled: true,
      maxFollowUps: 5,
      scheduleConfig: { timezone: 'UTC', days: [0, 1, 2, 3, 4, 5, 6], startTime: '00:00', endTime: '23:59' },
      steps: [
        {
          id: 'step_0',
          order: 0,
          enabled: true,
          delayAmount: 0,
          delayUnit: 'DAYS',
          subjectTemplate: 'Initial',
          bodyTemplate: 'Body 0',
        },
        {
          id: 'step_1',
          order: 1,
          enabled: true,
          delayAmount: 2,
          delayUnit: 'DAYS',
          subjectTemplate: 'Follow-up 1',
          bodyTemplate: 'Body 1',
        },
      ],
    }));

    const { SendingJobService } = await import('./job-service.js');
    const service = new SendingJobService();
    const result = await service.scheduleNextStep(baseJob);

    expect(result).not.toBeNull();
    expect(sendingJobUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sequenceStepId: 'step_1',
          templateSubject: 'Follow-up 1',
          templateBody: 'Body 1',
        }),
      }),
    );
  });
});

describe('SendingJobService.claimJob', () => {
  it('claims a SCHEDULED job exactly once', async () => {
    let claimed = false;
    sendingJobFindUniqueMock.mockImplementation(async () => {
      if (claimed) {
        return { id: 'job_1', status: 'PROCESSING', attempts: 1 };
      }
      return { id: 'job_1', status: 'SCHEDULED', attempts: 0 };
    });
    sendingJobUpdateMock.mockImplementation(async () => {
      claimed = true;
      return { id: 'job_1', status: 'PROCESSING', attempts: 1 };
    });

    const { SendingJobService } = await import('./job-service.js');
    const service = new SendingJobService();

    const first = await service.claimJob('job_1');
    const second = await service.claimJob('job_1');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});
