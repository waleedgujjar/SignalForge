import { describe, expect, it, vi, beforeEach } from 'vitest';

const MockWorkflowEventType = vi.hoisted(() => ({
  LEAD_CREATED: 'LEAD_CREATED' as const,
}));

vi.mock('@signalforge/database', () => ({
  prisma: {
    workflowEvent: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  },
  WorkflowEventType: MockWorkflowEventType,
}));

vi.mock('@signalforge/config', () => ({
  loadEnv: vi.fn(() => ({ REDIS_URL: 'redis://localhost:6379' })),
}));

vi.mock('./bullmq.js', () => ({
  createQueue: vi.fn(() => ({})),
}));

vi.mock('./redis.js', () => ({
  createRedisConnection: vi.fn(() => ({})),
}));

vi.mock('./workflow.js', () => ({
  enqueueWorkflowEvent: vi.fn(),
}));

import { prisma, WorkflowEventType } from '@signalforge/database';
import { enqueueWorkflowEvent } from './workflow.js';
import { publishWorkflowEvent, type PublishWorkflowEventInput } from './workflow-events.js';

const createMock = prisma.workflowEvent.create as ReturnType<typeof vi.fn>;
const findFirstMock = prisma.workflowEvent.findFirst as ReturnType<typeof vi.fn>;
const enqueueMock = enqueueWorkflowEvent as ReturnType<typeof vi.fn>;

const baseInput: PublishWorkflowEventInput = {
  eventType: WorkflowEventType.LEAD_CREATED,
  workspaceId: 'ws-1',
  leadId: 'lead-1',
  idempotencyKey: 'key-1',
};

describe('publishWorkflowEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates event and enqueues it', async () => {
    createMock.mockResolvedValue({ id: 'evt-1' });
    enqueueMock.mockResolvedValue(undefined);

    const result = await publishWorkflowEvent(baseInput);

    expect(result).toBe('evt-1');
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'ws-1',
        eventType: 'LEAD_CREATED',
        leadId: 'lead-1',
        idempotencyKey: 'key-1',
      }),
    });
    expect(enqueueMock).toHaveBeenCalledWith(expect.anything(), { workflowEventId: 'evt-1' });
  });

  it('defaults optional fields to null', async () => {
    const minimalInput: PublishWorkflowEventInput = {
      eventType: WorkflowEventType.LEAD_CREATED,
      workspaceId: 'ws-2',
      idempotencyKey: 'key-2',
    };
    createMock.mockResolvedValue({ id: 'evt-2' });
    enqueueMock.mockResolvedValue(undefined);

    await publishWorkflowEvent(minimalInput);

    const call = createMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.leadId).toBeUndefined();
    expect(call.data.campaignId).toBeUndefined();
    expect(call.data.mailboxId).toBeUndefined();
    expect(call.data.conversationId).toBeUndefined();
  });

  it('returns existing event id on P2002 duplicate key error', async () => {
    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    createMock.mockRejectedValue(p2002);
    findFirstMock.mockResolvedValue({ id: 'existing-evt' });

    const result = await publishWorkflowEvent(baseInput);

    expect(result).toBe('existing-evt');
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', idempotencyKey: 'key-1' },
    });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('returns null when P2002 and no existing event found', async () => {
    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    createMock.mockRejectedValue(p2002);
    findFirstMock.mockResolvedValue(null);

    const result = await publishWorkflowEvent(baseInput);

    expect(result).toBeNull();
  });

  it('re-throws non-P2002 errors', async () => {
    const dbError = Object.assign(new Error('Connection lost'), { code: 'P1001' });
    createMock.mockRejectedValue(dbError);

    await expect(publishWorkflowEvent(baseInput)).rejects.toThrow('Connection lost');
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('includes metadata in payload', async () => {
    const input: PublishWorkflowEventInput = {
      ...baseInput,
      metadata: { source: 'api', step: 3 },
    };
    createMock.mockResolvedValue({ id: 'evt-3' });
    enqueueMock.mockResolvedValue(undefined);

    await publishWorkflowEvent(input);

    const call = createMock.mock.calls[0]![0] as { data: { payload: { metadata: unknown } } };
    const payload = call.data.payload;
    expect(payload.metadata).toEqual({ source: 'api', step: 3 });
  });
});
