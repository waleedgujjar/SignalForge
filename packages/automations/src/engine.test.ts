import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockPrisma, mockEnqueueWorkflowStep, mockMatchWorkflowsForEvent, mockRunActionNode, mockBuildLeadConditionContext, mockEvaluateCondition } = vi.hoisted(() => {
  const mockPrisma = {
    workflowEvent: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workflow: {
      findFirst: vi.fn(),
    },
    workflowExecution: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    workflowVersion: {
      findUnique: vi.fn(),
    },
    workflowNodeExecution: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  const mockEnqueueWorkflowStep = vi.fn().mockResolvedValue(undefined);
  const mockMatchWorkflowsForEvent = vi.fn();
  const mockRunActionNode = vi.fn();
  const mockBuildLeadConditionContext = vi.fn();
  const mockEvaluateCondition = vi.fn();
  return { mockPrisma, mockEnqueueWorkflowStep, mockMatchWorkflowsForEvent, mockRunActionNode, mockBuildLeadConditionContext, mockEvaluateCondition };
});

vi.mock('@signalforge/database', () => ({
  prisma: mockPrisma,
  Prisma: {},
}));

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({ REDIS_URL: 'redis://localhost' }),
}));

vi.mock('@signalforge/queue', () => ({
  createQueue: () => ({}),
  createRedisConnection: () => ({}),
  QUEUE_NAMES: { WORKFLOW: 'workflow' },
  enqueueWorkflowStep: mockEnqueueWorkflowStep,
}));

vi.mock('./queue-helpers.js', () => ({
  enqueueWorkflowStep: mockEnqueueWorkflowStep,
}));

vi.mock('./trigger-matcher.js', () => ({
  matchWorkflowsForEvent: mockMatchWorkflowsForEvent,
}));

vi.mock('./actions/index.js', () => ({
  runActionNode: mockRunActionNode,
}));

vi.mock('./conditions.js', () => ({
  buildLeadConditionContext: mockBuildLeadConditionContext,
  evaluateCondition: mockEvaluateCondition,
}));

vi.mock('./delay.js', () => ({
  calculateResumeAt: (now: Date, amount: number) => new Date(now.getTime() + amount * 60 * 60 * 1000),
}));

import { processWorkflowEvent, advanceWorkflowExecution, cancelActiveExecutions } from './engine.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processWorkflowEvent', () => {
  it('returns early when event not found', async () => {
    mockPrisma.workflowEvent.findUnique.mockResolvedValue(null);

    await processWorkflowEvent('evt1');
    expect(mockMatchWorkflowsForEvent).not.toHaveBeenCalled();
  });

  it('returns early when event already processed', async () => {
    mockPrisma.workflowEvent.findUnique.mockResolvedValue({
      id: 'evt1',
      processedAt: new Date(),
    });

    await processWorkflowEvent('evt1');
    expect(mockMatchWorkflowsForEvent).not.toHaveBeenCalled();
  });

  it('marks event as processed after handling', async () => {
    mockPrisma.workflowEvent.findUnique.mockResolvedValue({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
      campaignId: null,
      mailboxId: null,
      conversationId: null,
      payload: {},
      processedAt: null,
    });
    mockMatchWorkflowsForEvent.mockResolvedValue([]);
    mockPrisma.workflowEvent.update.mockResolvedValue({});

    await processWorkflowEvent('evt1');
    expect(mockPrisma.workflowEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt1' },
      data: { processedAt: expect.any(Date) },
    });
  });

  it('creates executions for matched workflows', async () => {
    mockPrisma.workflowEvent.findUnique.mockResolvedValue({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: 'lead1',
      campaignId: null,
      mailboxId: null,
      conversationId: null,
      payload: {},
      processedAt: null,
    });
    mockMatchWorkflowsForEvent.mockResolvedValue([{
      workflowId: 'wf1',
      workflowVersionId: 'ver1',
      triggerNodeId: 'trigger',
    }]);
    mockPrisma.workflow.findFirst.mockResolvedValue({ id: 'wf1', status: 'ACTIVE' });
    mockPrisma.workflowExecution.findFirst.mockResolvedValue(null);
    mockPrisma.workflowExecution.create.mockResolvedValue({
      id: 'exec1',
      currentNodeId: 'trigger',
    });
    mockPrisma.workflowVersion.findUnique.mockResolvedValue({
      id: 'ver1',
      nodes: [
        { id: 'trigger', type: 'TRIGGER', position: { x: 0, y: 0 }, data: { eventType: 'LEAD_CREATED' } },
        { id: 'action', type: 'NOTIFY_USER', position: { x: 0, y: 100 }, data: { title: 'Hi', body: 'Hello' } },
        { id: 'stop', type: 'STOP_WORKFLOW', position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'action' },
        { id: 'e2', source: 'action', target: 'stop' },
      ],
    });
    mockPrisma.workflowExecution.update.mockResolvedValue({});
    mockPrisma.workflowEvent.update.mockResolvedValue({});

    await processWorkflowEvent('evt1');

    expect(mockPrisma.workflowExecution.create).toHaveBeenCalled();
    expect(mockEnqueueWorkflowStep).toHaveBeenCalled();
  });

  it('skips execution creation when leadId is null', async () => {
    mockPrisma.workflowEvent.findUnique.mockResolvedValue({
      id: 'evt1',
      eventType: 'LEAD_CREATED',
      workspaceId: 'ws1',
      leadId: null,
      campaignId: null,
      mailboxId: null,
      conversationId: null,
      payload: {},
      processedAt: null,
    });
    mockMatchWorkflowsForEvent.mockResolvedValue([{
      workflowId: 'wf1',
      workflowVersionId: 'ver1',
      triggerNodeId: 'trigger',
    }]);
    mockPrisma.workflowEvent.update.mockResolvedValue({});

    await processWorkflowEvent('evt1');
    expect(mockPrisma.workflowExecution.create).not.toHaveBeenCalled();
  });
});

describe('advanceWorkflowExecution', () => {
  const baseExecution = {
    id: 'exec1',
    workspaceId: 'ws1',
    leadId: 'lead1',
    status: 'RUNNING',
    stepCount: 0,
    startedAt: new Date(),
    currentNodeId: 'action1',
    resumeAt: null,
    context: { leadId: 'lead1', workspaceId: 'ws1' },
    workflow: { id: 'wf1', status: 'ACTIVE' },
    workflowVersion: {
      id: 'ver1',
      nodes: [
        { id: 'trigger', type: 'TRIGGER', position: { x: 0, y: 0 }, data: { eventType: 'LEAD_CREATED' } },
        { id: 'action1', type: 'NOTIFY_USER', position: { x: 0, y: 100 }, data: { title: 'Hi', body: 'Hello' } },
        { id: 'stop', type: 'STOP_WORKFLOW', position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'action1' },
        { id: 'e2', source: 'action1', target: 'stop' },
      ],
    },
  };

  it('returns early when execution not found', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue(null);

    await advanceWorkflowExecution('exec1');
    expect(mockRunActionNode).not.toHaveBeenCalled();
  });

  it('returns early for completed execution', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      status: 'COMPLETED',
    });

    await advanceWorkflowExecution('exec1');
    expect(mockRunActionNode).not.toHaveBeenCalled();
  });

  it('returns early for failed execution', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      status: 'FAILED',
    });

    await advanceWorkflowExecution('exec1');
    expect(mockRunActionNode).not.toHaveBeenCalled();
  });

  it('returns early for cancelled execution', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      status: 'CANCELLED',
    });

    await advanceWorkflowExecution('exec1');
    expect(mockRunActionNode).not.toHaveBeenCalled();
  });

  it('pauses execution when workflow is paused', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      workflow: { id: 'wf1', status: 'PAUSED' },
    });
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1', 'STEP');
    expect(mockPrisma.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: 'exec1' },
      data: { status: 'PAUSED' },
    });
  });

  it('fails expired execution', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      startedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockPrisma.workflowExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('fails execution that exceeded step limit', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      stepCount: 100,
    });
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockPrisma.workflowExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('completes execution when currentNodeId is null', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      currentNodeId: null,
    });
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockPrisma.workflowExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  it('fails when node not found in graph', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      currentNodeId: 'nonexistent',
    });
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockPrisma.workflowExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('advances past TRIGGER node to next node', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      currentNodeId: 'trigger',
    });
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockPrisma.workflowExecution.update).toHaveBeenCalled();
    expect(mockEnqueueWorkflowStep).toHaveBeenCalled();
  });

  it('runs action node and advances', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue(baseExecution);
    mockPrisma.workflowNodeExecution.create.mockResolvedValue({
      id: 'ne1',
      attempts: 1,
    });
    mockRunActionNode.mockResolvedValue({ success: true, branch: 'default' });
    mockPrisma.workflowNodeExecution.update.mockResolvedValue({});
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockRunActionNode).toHaveBeenCalled();
    expect(mockEnqueueWorkflowStep).toHaveBeenCalled();
  });

  it('handles action failure with retry for transient error', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue(baseExecution);
    mockPrisma.workflowNodeExecution.create.mockResolvedValue({
      id: 'ne1',
      attempts: 1,
    });
    mockRunActionNode.mockResolvedValue({
      success: false,
      error: 'Timeout',
      errorCategory: 'TRANSIENT_ERROR',
    });
    mockPrisma.workflowNodeExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockEnqueueWorkflowStep).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'RETRY' }),
    );
  });

  it('fails execution on non-transient action error', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue(baseExecution);
    mockPrisma.workflowNodeExecution.create.mockResolvedValue({
      id: 'ne1',
      attempts: 1,
    });
    mockRunActionNode.mockResolvedValue({
      success: false,
      error: 'Config error',
      errorCategory: 'CONFIGURATION_ERROR',
    });
    mockPrisma.workflowNodeExecution.update.mockResolvedValue({});
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockPrisma.workflowExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('handles STOP_WORKFLOW action', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      currentNodeId: 'stop',
    });
    mockPrisma.workflowNodeExecution.create.mockResolvedValue({
      id: 'ne1',
      attempts: 1,
    });
    mockRunActionNode.mockResolvedValue({ success: true, output: { stopped: true } });
    mockPrisma.workflowNodeExecution.update.mockResolvedValue({});
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockPrisma.workflowExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  it('handles DELAY node by setting WAITING status', async () => {
    const delayExecution = {
      ...baseExecution,
      currentNodeId: 'delay1',
      workflowVersion: {
        id: 'ver1',
        nodes: [
          { id: 'trigger', type: 'TRIGGER', position: { x: 0, y: 0 }, data: { eventType: 'LEAD_CREATED' } },
          { id: 'delay1', type: 'DELAY', position: { x: 0, y: 100 }, data: { amount: 2, unit: 'HOURS' } },
          { id: 'stop', type: 'STOP_WORKFLOW', position: { x: 0, y: 200 }, data: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'delay1' },
          { id: 'e2', source: 'delay1', target: 'stop' },
        ],
      },
    };

    mockPrisma.workflowExecution.findUnique.mockResolvedValue(delayExecution);
    mockPrisma.workflowNodeExecution.create.mockResolvedValue({ id: 'ne1', attempts: 1 });
    mockPrisma.workflowNodeExecution.update.mockResolvedValue({});
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockPrisma.workflowExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'WAITING' }),
      }),
    );
  });

  it('handles CONDITION node branching to yes', async () => {
    const condExecution = {
      ...baseExecution,
      currentNodeId: 'cond1',
      workflowVersion: {
        id: 'ver1',
        nodes: [
          { id: 'trigger', type: 'TRIGGER', position: { x: 0, y: 0 }, data: { eventType: 'LEAD_CREATED' } },
          { id: 'cond1', type: 'CONDITION', position: { x: 0, y: 100 }, data: { logic: 'AND', rules: [{ field: 'a', operator: 'equals', value: '1' }] } },
          { id: 'yes-target', type: 'STOP_WORKFLOW', position: { x: 0, y: 200 }, data: {} },
          { id: 'no-target', type: 'STOP_WORKFLOW', position: { x: 100, y: 200 }, data: {} },
        ],
        edges: [
          { id: 'e1', source: 'trigger', target: 'cond1' },
          { id: 'e2', source: 'cond1', target: 'yes-target', sourceHandle: 'yes' },
          { id: 'e3', source: 'cond1', target: 'no-target', sourceHandle: 'no' },
        ],
      },
    };

    mockPrisma.workflowExecution.findUnique.mockResolvedValue(condExecution);
    mockPrisma.workflowNodeExecution.create.mockResolvedValue({ id: 'ne1', attempts: 1 });
    mockBuildLeadConditionContext.mockResolvedValue({ a: '1' });
    mockEvaluateCondition.mockReturnValue(true);
    mockPrisma.workflowNodeExecution.update.mockResolvedValue({});
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockEvaluateCondition).toHaveBeenCalled();
    expect(mockPrisma.workflowNodeExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: expect.objectContaining({ passed: true, branch: 'yes' }),
        }),
      }),
    );
  });

  it('handles duplicate node execution (P2002 error)', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue(baseExecution);
    mockPrisma.workflowNodeExecution.create.mockRejectedValue({ code: 'P2002' });
    mockPrisma.workflowNodeExecution.findUnique.mockResolvedValue({
      status: 'COMPLETED',
      result: { branch: 'default' },
    });
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    // Should handle gracefully and advance
    expect(mockPrisma.workflowExecution.update).toHaveBeenCalled();
  });

  it('handles WAITING status with DELAY_RESUME', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      status: 'WAITING',
      resumeAt: new Date(Date.now() - 1000), // past
    });
    mockPrisma.workflowExecution.update.mockResolvedValue({});
    mockPrisma.workflowNodeExecution.create.mockResolvedValue({ id: 'ne1', attempts: 1 });
    mockRunActionNode.mockResolvedValue({ success: true });
    mockPrisma.workflowNodeExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1', 'DELAY_RESUME');
    // Should resume and process
    expect(mockPrisma.workflowExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'RUNNING', resumeAt: null }),
      }),
    );
  });

  it('does not resume WAITING execution if resumeAt is in the future', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      status: 'WAITING',
      resumeAt: new Date(Date.now() + 60000), // future
    });

    await advanceWorkflowExecution('exec1', 'DELAY_RESUME');
    // Should not proceed to run action
    expect(mockRunActionNode).not.toHaveBeenCalled();
  });

  it('does not advance WAITING execution without DELAY_RESUME reason', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue({
      ...baseExecution,
      status: 'WAITING',
    });

    await advanceWorkflowExecution('exec1', 'STEP');
    expect(mockRunActionNode).not.toHaveBeenCalled();
  });

  it('handles runtime errors in action execution', async () => {
    mockPrisma.workflowExecution.findUnique.mockResolvedValue(baseExecution);
    mockPrisma.workflowNodeExecution.create.mockResolvedValue({ id: 'ne1', attempts: 1 });
    mockRunActionNode.mockRejectedValue(new Error('Unexpected error'));
    mockPrisma.workflowNodeExecution.update.mockResolvedValue({});
    mockPrisma.workflowExecution.update.mockResolvedValue({});

    await advanceWorkflowExecution('exec1');
    expect(mockPrisma.workflowNodeExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorCategory: 'SYSTEM_ERROR',
        }),
      }),
    );
  });
});

describe('cancelActiveExecutions', () => {
  it('cancels all active executions for a workflow', async () => {
    mockPrisma.workflowExecution.updateMany.mockResolvedValue({ count: 3 });

    const count = await cancelActiveExecutions('wf1');
    expect(count).toBe(3);
    expect(mockPrisma.workflowExecution.updateMany).toHaveBeenCalledWith({
      where: {
        workflowId: 'wf1',
        status: { in: ['RUNNING', 'WAITING', 'PAUSED'] },
      },
      data: expect.objectContaining({ status: 'CANCELLED' }),
    });
  });

  it('returns zero when no active executions', async () => {
    mockPrisma.workflowExecution.updateMany.mockResolvedValue({ count: 0 });

    const count = await cancelActiveExecutions('wf1');
    expect(count).toBe(0);
  });
});
