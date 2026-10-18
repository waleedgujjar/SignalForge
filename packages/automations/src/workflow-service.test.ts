import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    workflow: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    workflowVersion: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    workflowExecution: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    workflowNodeExecution: {
      findMany: vi.fn(),
    },
    workflowActivity: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@signalforge/database', () => ({ prisma: mockPrisma }));

vi.mock('./engine.js', () => ({
  cancelActiveExecutions: vi.fn().mockResolvedValue(0),
}));

import { WorkflowService, getTemplates } from './workflow-service.js';

let service: WorkflowService;

const fullWorkflow = {
  id: 'wf1',
  workspaceId: 'ws1',
  name: 'Test Workflow',
  description: null,
  status: 'DRAFT',
  publishedVersionId: null,
  publishedVersion: null,
  versions: [{
    id: 'v1',
    version: 1,
    publishedAt: null,
    nodes: [],
    edges: [],
  }],
  _count: { executions: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  service = new WorkflowService();
  mockPrisma.workflowActivity.create.mockResolvedValue({});
});

describe('WorkflowService.create', () => {
  it('creates a new workflow with a draft version', async () => {
    mockPrisma.workflow.create.mockResolvedValue({ id: 'wf1', workspaceId: 'ws1' });
    mockPrisma.workflowVersion.create.mockResolvedValue({ id: 'v1' });
    mockPrisma.workflow.findFirst.mockResolvedValue(fullWorkflow);

    const result = await service.create('ws1', { name: 'My Workflow' });
    expect(result).toBeDefined();
    expect(mockPrisma.workflow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: 'ws1',
        name: 'My Workflow',
        status: 'DRAFT',
      }),
    });
    expect(mockPrisma.workflowVersion.create).toHaveBeenCalled();
    expect(mockPrisma.workflowActivity.create).toHaveBeenCalled();
  });
});

describe('WorkflowService.getById', () => {
  it('returns workflow by id', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(fullWorkflow);

    const result = await service.getById('wf1', 'ws1');
    expect(result.id).toBe('wf1');
  });

  it('throws when workflow not found', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(null);

    await expect(service.getById('wf1', 'ws1')).rejects.toThrow('Workflow not found');
  });
});

describe('WorkflowService.list', () => {
  it('lists workflows for workspace', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([fullWorkflow]);

    const result = await service.list('ws1');
    expect(result).toHaveLength(1);
  });

  it('filters by status', async () => {
    mockPrisma.workflow.findMany.mockResolvedValue([]);

    await service.list('ws1', 'ACTIVE');
    expect(mockPrisma.workflow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });
});

describe('WorkflowService.updateDraft', () => {
  it('updates workflow name and graph', async () => {
    mockPrisma.workflow.findFirst
      .mockResolvedValueOnce({
        ...fullWorkflow,
        versions: [{ id: 'v1', version: 1 }],
      })
      .mockResolvedValue(fullWorkflow);
    mockPrisma.workflow.update.mockResolvedValue({});
    mockPrisma.workflowVersion.update.mockResolvedValue({});

    const result = await service.updateDraft('wf1', 'ws1', {
      name: 'Updated',
      nodes: [{ id: 'n1' }],
      edges: [],
    });
    expect(result).toBeDefined();
    expect(mockPrisma.workflow.update).toHaveBeenCalled();
    expect(mockPrisma.workflowVersion.update).toHaveBeenCalled();
  });

  it('throws when workflow not found', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(null);

    await expect(service.updateDraft('wf1', 'ws1', { name: 'X' })).rejects.toThrow('Workflow not found');
  });

  it('throws when workflow is archived', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue({
      ...fullWorkflow,
      status: 'ARCHIVED',
      versions: [{ id: 'v1' }],
    });

    await expect(service.updateDraft('wf1', 'ws1', { name: 'X' })).rejects.toThrow('Cannot edit archived workflow');
  });

  it('throws when no draft version found', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue({
      ...fullWorkflow,
      versions: [],
    });

    await expect(service.updateDraft('wf1', 'ws1', { name: 'X' })).rejects.toThrow('No draft version found');
  });
});

describe('WorkflowService.publish', () => {
  it('publishes a valid workflow', async () => {
    const validNodes = [
      { id: 'trigger', type: 'TRIGGER', position: { x: 0, y: 0 }, data: { eventType: 'LEAD_CREATED' } },
      { id: 'notify', type: 'NOTIFY_USER', position: { x: 0, y: 100 }, data: { title: 'Hi', body: 'Hello' } },
      { id: 'stop', type: 'STOP_WORKFLOW', position: { x: 0, y: 200 }, data: {} },
    ];
    const validEdges = [
      { id: 'e1', source: 'trigger', target: 'notify' },
      { id: 'e2', source: 'notify', target: 'stop' },
    ];

    mockPrisma.workflow.findFirst
      .mockResolvedValueOnce({
        ...fullWorkflow,
        versions: [{ id: 'v1', version: 1, nodes: validNodes, edges: validEdges, publishedAt: null }],
      })
      .mockResolvedValue({ ...fullWorkflow, status: 'ACTIVE', publishedVersionId: 'v1' });
    mockPrisma.workflowVersion.update.mockResolvedValue({ id: 'v1' });
    mockPrisma.workflow.update.mockResolvedValue({});

    const result = await service.publish('wf1', 'ws1');
    expect(result).toBeDefined();
    expect(mockPrisma.workflow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
  });

  it('throws when workflow not found', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue(null);

    await expect(service.publish('wf1', 'ws1')).rejects.toThrow('Workflow not found');
  });

  it('throws when validation fails', async () => {
    mockPrisma.workflow.findFirst.mockResolvedValue({
      ...fullWorkflow,
      versions: [{ id: 'v1', version: 1, nodes: [], edges: [], publishedAt: null }],
    });

    await expect(service.publish('wf1', 'ws1')).rejects.toThrow();
  });
});

describe('WorkflowService.pause', () => {
  it('pauses an active workflow', async () => {
    mockPrisma.workflow.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workflow.findFirst.mockResolvedValue({ ...fullWorkflow, status: 'PAUSED' });

    const result = await service.pause('wf1', 'ws1');
    expect(result).toBeDefined();
  });
});

describe('WorkflowService.resume', () => {
  it('resumes a paused workflow', async () => {
    mockPrisma.workflow.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workflow.findFirst.mockResolvedValue({ ...fullWorkflow, status: 'ACTIVE' });

    const result = await service.resume('wf1', 'ws1');
    expect(result).toBeDefined();
  });
});

describe('WorkflowService.archive', () => {
  it('archives workflow and cancels active executions', async () => {
    mockPrisma.workflow.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workflow.findFirst.mockResolvedValue({ ...fullWorkflow, status: 'ARCHIVED' });

    const result = await service.archive('wf1', 'ws1');
    expect(result).toBeDefined();
  });
});

describe('WorkflowService.duplicate', () => {
  it('duplicates a workflow', async () => {
    const sourceWorkflow = {
      ...fullWorkflow,
      name: 'Original',
      versions: [{ id: 'v1', version: 1, nodes: [{ id: 'n1' }], edges: [] }],
    };
    mockPrisma.workflow.findFirst
      .mockResolvedValueOnce(sourceWorkflow) // getById for source
      .mockResolvedValueOnce({ ...fullWorkflow, id: 'wf2' }) // getById after create
      .mockResolvedValueOnce({ ...fullWorkflow, id: 'wf2' }); // getById at end
    mockPrisma.workflow.create.mockResolvedValue({ id: 'wf2' });
    mockPrisma.workflowVersion.create.mockResolvedValue({ id: 'v2' });
    mockPrisma.workflowVersion.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.duplicate('wf1', 'ws1');
    expect(result).toBeDefined();
    expect(mockPrisma.workflow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Original (Copy)' }),
    });
  });
});

describe('WorkflowService.fromTemplate', () => {
  it('creates workflow from template', async () => {
    mockPrisma.workflow.create.mockResolvedValue({ id: 'wf1' });
    mockPrisma.workflowVersion.create.mockResolvedValue({ id: 'v1' });
    mockPrisma.workflow.findFirst.mockResolvedValue(fullWorkflow);
    mockPrisma.workflowVersion.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.fromTemplate('new-lead-outreach', 'ws1');
    expect(result).toBeDefined();
  });

  it('throws for unknown template', async () => {
    await expect(service.fromTemplate('non-existent', 'ws1')).rejects.toThrow('Template not found');
  });
});

describe('WorkflowService.cancelExecution', () => {
  it('cancels an active execution', async () => {
    mockPrisma.workflowExecution.findFirst.mockResolvedValue({ id: 'ex1', status: 'RUNNING' });
    mockPrisma.workflowExecution.update.mockResolvedValue({ id: 'ex1', status: 'CANCELLED' });

    const result = await service.cancelExecution('ex1', 'ws1');
    expect(result.status).toBe('CANCELLED');
  });

  it('throws when execution not found', async () => {
    mockPrisma.workflowExecution.findFirst.mockResolvedValue(null);

    await expect(service.cancelExecution('ex1', 'ws1')).rejects.toThrow('Execution not found');
  });

  it('throws when execution is already terminal', async () => {
    mockPrisma.workflowExecution.findFirst.mockResolvedValue({ id: 'ex1', status: 'COMPLETED' });

    await expect(service.cancelExecution('ex1', 'ws1')).rejects.toThrow('Execution already terminal');
  });

  it('throws for FAILED status', async () => {
    mockPrisma.workflowExecution.findFirst.mockResolvedValue({ id: 'ex1', status: 'FAILED' });

    await expect(service.cancelExecution('ex1', 'ws1')).rejects.toThrow('Execution already terminal');
  });

  it('throws for CANCELLED status', async () => {
    mockPrisma.workflowExecution.findFirst.mockResolvedValue({ id: 'ex1', status: 'CANCELLED' });

    await expect(service.cancelExecution('ex1', 'ws1')).rejects.toThrow('Execution already terminal');
  });
});

describe('WorkflowService.getExecution', () => {
  it('returns execution details', async () => {
    mockPrisma.workflowExecution.findFirst.mockResolvedValue({ id: 'ex1' });

    const result = await service.getExecution('ex1', 'ws1');
    expect(result.id).toBe('ex1');
  });

  it('throws when execution not found', async () => {
    mockPrisma.workflowExecution.findFirst.mockResolvedValue(null);

    await expect(service.getExecution('ex1', 'ws1')).rejects.toThrow('Execution not found');
  });
});

describe('WorkflowService.listExecutions', () => {
  it('lists executions for a workflow', async () => {
    mockPrisma.workflowExecution.findMany.mockResolvedValue([{ id: 'ex1' }]);

    const result = await service.listExecutions('wf1', 'ws1');
    expect(result).toHaveLength(1);
  });

  it('respects custom limit', async () => {
    mockPrisma.workflowExecution.findMany.mockResolvedValue([]);

    await service.listExecutions('wf1', 'ws1', 10);
    expect(mockPrisma.workflowExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });
});

describe('WorkflowService.listLogs', () => {
  it('lists node execution logs', async () => {
    mockPrisma.workflowNodeExecution.findMany.mockResolvedValue([{ id: 'ne1' }]);

    const result = await service.listLogs('wf1', 'ws1');
    expect(result).toHaveLength(1);
  });
});

describe('WorkflowService.listActivities', () => {
  it('lists workflow activities', async () => {
    mockPrisma.workflowActivity.findMany.mockResolvedValue([{ id: 'a1', type: 'CREATED' }]);

    const result = await service.listActivities('wf1', 'ws1');
    expect(result).toHaveLength(1);
  });
});

describe('getTemplates', () => {
  it('returns template summaries without full graph', () => {
    const templates = getTemplates();
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect((t as Record<string, unknown>).graph).toBeUndefined();
    }
  });
});
