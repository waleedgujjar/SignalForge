import { prisma } from '@signalforge/database';

export class WorkflowStatsService {
  async getWorkflowStats(workflowId: string, workspaceId: string) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, workspaceId },
    });
    if (!workflow) throw new Error('Workflow not found');

    const [started, completed, failed, waiting, running] = await Promise.all([
      prisma.workflowExecution.count({ where: { workflowId } }),
      prisma.workflowExecution.count({ where: { workflowId, status: 'COMPLETED' } }),
      prisma.workflowExecution.count({ where: { workflowId, status: 'FAILED' } }),
      prisma.workflowExecution.count({ where: { workflowId, status: 'WAITING' } }),
      prisma.workflowExecution.count({ where: { workflowId, status: 'RUNNING' } }),
    ]);

    const emailsTriggered = await prisma.workflowNodeExecution.count({
      where: {
        execution: { workflowId },
        nodeType: { in: ['SEND_EMAIL', 'SEND_SEQUENCE'] },
        status: 'COMPLETED',
      },
    });

    return { started, completed, failed, waiting, running, emailsTriggered };
  }

  async listWorkspaceStats(workspaceId: string) {
    const workflows = await prisma.workflow.findMany({
      where: { workspaceId, status: { not: 'ARCHIVED' } },
      select: { id: true, name: true, status: true },
    });

    const stats = await Promise.all(
      workflows.map(async (w: { id: string; name: string; status: string }) => ({
        ...w,
        stats: await this.getWorkflowStats(w.id, workspaceId),
      })),
    );

    return stats;
  }
}

export const workflowStatsService = new WorkflowStatsService();
