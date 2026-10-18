import { prisma, type Prisma } from '@signalforge/database';
import type { WorkflowActivityType, WorkflowStatus } from '@signalforge/database';
import { validateWorkflowGraph } from './validation.js';
import { cancelActiveExecutions } from './engine.js';
import { WORKFLOW_TEMPLATES } from './templates.js';

export class WorkflowService {
  async create(workspaceId: string, input: { name: string; description?: string; createdById?: string }) {
    const workflow = await prisma.workflow.create({
      data: {
        workspaceId,
        name: input.name,
        description: input.description,
        createdById: input.createdById,
        status: 'DRAFT',
      },
    });

    await prisma.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        nodes: [],
        edges: [],
      },
    });

    await this.logActivity(workflow.id, workspaceId, 'CREATED', 'Workflow created', input.createdById);
    return this.getById(workflow.id, workspaceId);
  }

  async getById(workflowId: string, workspaceId: string) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, workspaceId },
      include: {
        publishedVersion: true,
        versions: { orderBy: { version: 'desc' }, take: 1 },
        _count: { select: { executions: true } },
      },
    });
    if (!workflow) throw new Error('Workflow not found');
    return workflow;
  }

  async list(workspaceId: string, status?: WorkflowStatus) {
    return prisma.workflow.findMany({
      where: { workspaceId, ...(status ? { status } : {}) },
      include: {
        publishedVersion: true,
        _count: { select: { executions: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async updateDraft(
    workflowId: string,
    workspaceId: string,
    input: { name?: string; description?: string; nodes?: unknown; edges?: unknown },
    actorUserId?: string,
  ) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, workspaceId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!workflow) throw new Error('Workflow not found');
    if (workflow.status === 'ARCHIVED') throw new Error('Cannot edit archived workflow');

    const draftVersion = workflow.versions[0];
    if (!draftVersion) throw new Error('No draft version found');

    await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });

    if (input.nodes !== undefined || input.edges !== undefined) {
      await prisma.workflowVersion.update({
        where: { id: draftVersion.id },
        data: {
          ...(input.nodes !== undefined ? { nodes: input.nodes as object } : {}),
          ...(input.edges !== undefined ? { edges: input.edges as object } : {}),
        },
      });
    }

    await this.logActivity(workflowId, workspaceId, 'UPDATED', 'Workflow updated', actorUserId);
    return this.getById(workflowId, workspaceId);
  }

  async publish(workflowId: string, workspaceId: string, actorUserId?: string) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, workspaceId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!workflow) throw new Error('Workflow not found');

    const draft = workflow.versions[0];
    if (!draft) throw new Error('No draft version');

    const validation = validateWorkflowGraph(draft.nodes, draft.edges);
    if (!validation.valid) {
      throw new Error(JSON.stringify(validation.errors));
    }

    let publishedId = workflow.publishedVersionId;
    if (!publishedId || draft.publishedAt === null) {
      const published = await prisma.workflowVersion.update({
        where: { id: draft.id },
        data: { publishedAt: new Date() },
      });
      publishedId = published.id;
    } else {
      const nextVersion = draft.version + 1;
      const published = await prisma.workflowVersion.create({
        data: {
          workflowId,
          version: nextVersion,
          nodes: draft.nodes as object,
          edges: draft.edges as object,
          publishedAt: new Date(),
        },
      });
      publishedId = published.id;
    }

    await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        status: 'ACTIVE',
        publishedVersionId: publishedId,
      },
    });

    await this.logActivity(workflowId, workspaceId, 'PUBLISHED', 'Workflow published', actorUserId);
    return this.getById(workflowId, workspaceId);
  }

  async pause(workflowId: string, workspaceId: string, actorUserId?: string) {
    await prisma.workflow.updateMany({
      where: { id: workflowId, workspaceId, status: 'ACTIVE' },
      data: { status: 'PAUSED' },
    });
    await this.logActivity(workflowId, workspaceId, 'PAUSED', 'Workflow paused', actorUserId);
    return this.getById(workflowId, workspaceId);
  }

  async resume(workflowId: string, workspaceId: string, actorUserId?: string) {
    await prisma.workflow.updateMany({
      where: { id: workflowId, workspaceId, status: 'PAUSED' },
      data: { status: 'ACTIVE' },
    });
    await this.logActivity(workflowId, workspaceId, 'RESUMED', 'Workflow resumed', actorUserId);
    return this.getById(workflowId, workspaceId);
  }

  async archive(workflowId: string, workspaceId: string, actorUserId?: string) {
    await cancelActiveExecutions(workflowId);
    await prisma.workflow.updateMany({
      where: { id: workflowId, workspaceId },
      data: { status: 'ARCHIVED' },
    });
    await this.logActivity(workflowId, workspaceId, 'ARCHIVED', 'Workflow archived', actorUserId);
    return this.getById(workflowId, workspaceId);
  }

  async duplicate(workflowId: string, workspaceId: string, actorUserId?: string) {
    const source = await this.getById(workflowId, workspaceId);
    const draft = source.versions[0];
    const graph = draft ?? source.publishedVersion;

    const copy = await this.create(workspaceId, {
      name: `${source.name} (Copy)`,
      description: source.description ?? undefined,
      createdById: actorUserId,
    });

    if (graph) {
      await prisma.workflowVersion.updateMany({
        where: { workflowId: copy!.id },
        data: {
          nodes: graph.nodes as object,
          edges: graph.edges as object,
        },
      });
    }

    await this.logActivity(copy!.id, workspaceId, 'DUPLICATED', `Duplicated from ${source.name}`, actorUserId);
    return this.getById(copy!.id, workspaceId);
  }

  async fromTemplate(templateId: string, workspaceId: string, actorUserId?: string) {
    const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new Error('Template not found');

    const workflow = await this.create(workspaceId, {
      name: template.name,
      description: template.description,
      createdById: actorUserId,
    });

    await prisma.workflowVersion.updateMany({
      where: { workflowId: workflow.id },
      data: {
        nodes: template.graph.nodes as object,
        edges: template.graph.edges as object,
      },
    });

    return this.getById(workflow.id, workspaceId);
  }

  async listExecutions(workflowId: string, workspaceId: string, limit = 50) {
    return prisma.workflowExecution.findMany({
      where: { workflowId, workspaceId },
      include: {
        lead: { select: { id: true, email: true, firstName: true, lastName: true } },
        nodeExecutions: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getExecution(executionId: string, workspaceId: string) {
    const execution = await prisma.workflowExecution.findFirst({
      where: { id: executionId, workspaceId },
      include: {
        lead: true,
        workflow: { select: { id: true, name: true } },
        workflowVersion: true,
        nodeExecutions: { orderBy: { createdAt: 'asc' } },
        triggerEvent: true,
      },
    });
    if (!execution) throw new Error('Execution not found');
    return execution;
  }

  async cancelExecution(executionId: string, workspaceId: string) {
    const execution = await prisma.workflowExecution.findFirst({
      where: { id: executionId, workspaceId },
    });
    if (!execution) throw new Error('Execution not found');
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(execution.status)) {
      throw new Error('Execution already terminal');
    }

    return prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
  }

  async listLogs(workflowId: string, workspaceId: string, limit = 100) {
    return prisma.workflowNodeExecution.findMany({
      where: { execution: { workflowId, workspaceId } },
      include: {
        execution: {
          include: { lead: { select: { id: true, email: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async listActivities(workflowId: string, workspaceId: string) {
    return prisma.workflowActivity.findMany({
      where: { workflowId, workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async logActivity(
    workflowId: string,
    workspaceId: string,
    type: WorkflowActivityType,
    summary: string,
    actorUserId?: string,
    metadata?: Record<string, unknown>,
  ) {
    await prisma.workflowActivity.create({
      data: { workflowId, workspaceId, type, summary, actorUserId, metadata: (metadata ?? {}) as Prisma.InputJsonValue },
    });
  }
}

export const workflowService = new WorkflowService();

export function getTemplates() {
  return WORKFLOW_TEMPLATES.map(({ id, name, description }) => ({ id, name, description }));
}
