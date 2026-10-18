import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    workflow: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    workflowExecution: {
      count: vi.fn(),
    },
    workflowNodeExecution: {
      count: vi.fn(),
    },
  },
}));

vi.mock('@signalforge/database', () => ({ prisma: mockPrisma }));

import { WorkflowStatsService } from './stats-service.js';

let service: WorkflowStatsService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new WorkflowStatsService();
});

describe('WorkflowStatsService.getWorkflowStats', () => {
  it('returns stats for a workflow', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue({ id: 'wf1' });
    mockPrisma.workflowExecution.count
      .mockResolvedValueOnce(100) // started
      .mockResolvedValueOnce(80)  // completed
      .mockResolvedValueOnce(10)  // failed
      .mockResolvedValueOnce(5)   // waiting
      .mockResolvedValueOnce(3);  // running
    mockPrisma.workflowNodeExecution.count.mockResolvedValue(50);

    const stats = await service.getWorkflowStats('wf1', 'ws1');
    expect(stats).toEqual({
      started: 100,
      completed: 80,
      failed: 10,
      waiting: 5,
      running: 3,
      emailsTriggered: 50,
    });
  });

  it('throws when workflow not found', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(null);

    await expect(service.getWorkflowStats('wf1', 'ws1')).rejects.toThrow('Workflow not found');
  });
});

describe('WorkflowStatsService.listWorkspaceStats', () => {
  it('returns stats for all non-archived workflows', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([
      { id: 'wf1', name: 'Flow 1', status: 'ACTIVE' },
      { id: 'wf2', name: 'Flow 2', status: 'DRAFT' },
    ]);
    mockPrisma.workflow.findFirst.mockResolvedValue({ id: 'wf1' });
    mockPrisma.workflowExecution.count.mockResolvedValue(0);
    mockPrisma.workflowNodeExecution.count.mockResolvedValue(0);

    const stats = await service.listWorkspaceStats('ws1');
    expect(stats).toHaveLength(2);
    expect(stats[0]).toEqual(expect.objectContaining({ id: 'wf1', name: 'Flow 1' }));
    expect(stats[0]!.stats).toBeDefined();
  });

  it('returns empty array when no workflows', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([]);

    const stats = await service.listWorkspaceStats('ws1');
    expect(stats).toEqual([]);
  });
});
