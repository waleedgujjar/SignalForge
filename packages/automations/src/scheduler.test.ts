import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockPrisma, mockEnqueueWorkflowStep, mockAdvance } = vi.hoisted(() => {
  return {
    mockPrisma: {
      workflowExecution: {
        findMany: vi.fn(),
      },
    },
    mockEnqueueWorkflowStep: vi.fn(),
    mockAdvance: vi.fn(),
  };
});

vi.mock('@signalforge/database', () => ({
  prisma: mockPrisma,
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

vi.mock('./engine.js', () => ({
  advanceWorkflowExecution: mockAdvance,
}));

import { AutomationSchedulerService, createAutomationSchedulerService } from './scheduler.js';

let service: AutomationSchedulerService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new AutomationSchedulerService();
});

describe('AutomationSchedulerService.runTick', () => {
  it('returns zero counts when no due executions', async () => {
    mockPrisma.workflowExecution.findMany.mockResolvedValue([]);

    const result = await service.runTick();
    expect(result).toEqual({ resumed: 0, errors: 0 });
  });

  it('enqueues due executions', async () => {
    mockPrisma.workflowExecution.findMany.mockResolvedValue([
      { id: 'ex1' },
      { id: 'ex2' },
    ]);
    mockEnqueueWorkflowStep.mockResolvedValue(undefined);

    const result = await service.runTick();
    expect(result.resumed).toBe(2);
    expect(result.errors).toBe(0);
    expect(mockEnqueueWorkflowStep).toHaveBeenCalledTimes(2);
  });

  it('falls back to direct advance on enqueue error', async () => {
    mockPrisma.workflowExecution.findMany.mockResolvedValue([{ id: 'ex1' }]);
    mockEnqueueWorkflowStep.mockRejectedValue(new Error('Queue error'));
    mockAdvance.mockResolvedValue(undefined);

    const result = await service.runTick();
    expect(result.resumed).toBe(0);
    expect(mockAdvance).toHaveBeenCalledWith('ex1', 'DELAY_RESUME');
  });

  it('counts errors when both enqueue and advance fail', async () => {
    mockPrisma.workflowExecution.findMany.mockResolvedValue([{ id: 'ex1' }]);
    mockEnqueueWorkflowStep.mockRejectedValue(new Error('Queue error'));
    mockAdvance.mockRejectedValue(new Error('Advance error'));

    const result = await service.runTick();
    // enqueue fail = 1 error, advance fail = 1 more error
    expect(result.errors).toBe(2);
    expect(result.resumed).toBe(0);
  });

  it('uses provided now parameter', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    mockPrisma.workflowExecution.findMany.mockResolvedValue([]);

    await service.runTick(now);
    expect(mockPrisma.workflowExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          resumeAt: { lte: now },
        }),
      }),
    );
  });
});

describe('createAutomationSchedulerService', () => {
  it('returns a new instance', () => {
    const instance = createAutomationSchedulerService();
    expect(instance).toBeInstanceOf(AutomationSchedulerService);
  });
});
