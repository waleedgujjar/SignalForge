import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    workflow: { findMany: vi.fn() },
    leadTag: { findFirst: vi.fn() },
    leadListMember: { findFirst: vi.fn() },
  },
}));

vi.mock('@signalforge/database', () => ({ prisma: mockPrisma }));

import { matchWorkflowsForEvent } from './trigger-matcher.js';

beforeEach(() => {
  vi.clearAllMocks();
});

function makeWorkflow(overrides: {
  id?: string;
  eventType?: string;
  filters?: Record<string, unknown>;
} = {}) {
  const eventType = overrides.eventType ?? 'LEAD_CREATED';
  const filters = overrides.filters;
  return {
    id: overrides.id ?? 'wf1',
    publishedVersion: {
      id: 'ver1',
      nodes: [
        {
          id: 'trigger',
          type: 'TRIGGER',
          position: { x: 0, y: 0 },
          data: { eventType, ...(filters ? { filters } : {}) },
        },
        {
          id: 'action',
          type: 'NOTIFY_USER',
          position: { x: 0, y: 100 },
          data: { title: 'Hi', body: 'Hello' },
        },
        {
          id: 'stop',
          type: 'STOP_WORKFLOW',
          position: { x: 0, y: 200 },
          data: {},
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'action' },
        { id: 'e2', source: 'action', target: 'stop' },
      ],
    },
  };
}

describe('matchWorkflowsForEvent', () => {
  it('matches a workflow with matching event type', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([makeWorkflow()]);

    const result = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      workflowId: 'wf1',
      workflowVersionId: 'ver1',
      triggerNodeId: 'trigger',
    });
  });

  it('does not match when event type differs', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([
      makeWorkflow({ eventType: 'EMAIL_BOUNCED' }),
    ]);

    const result = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
    });

    expect(result).toHaveLength(0);
  });

  it('returns empty when no workflows exist', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([]);

    const result = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
    });

    expect(result).toEqual([]);
  });

  it('skips workflows without published version', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([
      { id: 'wf1', publishedVersion: null },
    ]);

    const result = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
    });

    expect(result).toEqual([]);
  });

  it('filters by campaignId', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([
      makeWorkflow({ filters: { campaignId: 'camp1' } }),
    ]);

    const match = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
      campaignId: 'camp1',
    });
    expect(match).toHaveLength(1);

    const noMatch = await matchWorkflowsForEvent({
      id: 'evt2',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
      campaignId: 'camp2',
    });
    expect(noMatch).toHaveLength(0);
  });

  it('filters by country in metadata', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([
      makeWorkflow({ filters: { country: 'USA' } }),
    ]);

    const match = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
      payload: { metadata: { country: 'USA' } },
    });
    expect(match).toHaveLength(1);

    const noMatch = await matchWorkflowsForEvent({
      id: 'evt2',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
      payload: { metadata: { country: 'UK' } },
    });
    expect(noMatch).toHaveLength(0);
  });

  it('filters by tagId using prisma lookup', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([
      makeWorkflow({ filters: { tagId: 'tag1' } }),
    ]);
    mockPrisma.leadTag.findFirst.mockResolvedValue({ id: 'lt1' });

    const result = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
    });

    expect(result).toHaveLength(1);
    expect(mockPrisma.leadTag.findFirst).toHaveBeenCalled();
  });

  it('rejects when lead does not have the required tag', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([
      makeWorkflow({ filters: { tagId: 'tag1' } }),
    ]);
    mockPrisma.leadTag.findFirst.mockResolvedValue(null);

    const result = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
    });

    expect(result).toHaveLength(0);
  });

  it('filters by listId using prisma lookup', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([
      makeWorkflow({ filters: { listId: 'list1' } }),
    ]);
    mockPrisma.leadListMember.findFirst.mockResolvedValue({ id: 'lm1' });

    const result = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
    });

    expect(result).toHaveLength(1);
  });

  it('rejects when lead is not in the required list', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([
      makeWorkflow({ filters: { listId: 'list1' } }),
    ]);
    mockPrisma.leadListMember.findFirst.mockResolvedValue(null);

    const result = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
    });

    expect(result).toHaveLength(0);
  });

  it('rejects tag/list filters when leadId is missing', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([
      makeWorkflow({ filters: { tagId: 'tag1' } }),
    ]);

    const result = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: null,
    });

    expect(result).toHaveLength(0);
  });

  it('matches multiple workflows', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([
      makeWorkflow({ id: 'wf1' }),
      makeWorkflow({ id: 'wf2' }),
    ]);

    const result = await matchWorkflowsForEvent({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
    });

    expect(result).toHaveLength(2);
  });
});
