import type { WorkflowEventType } from '@signalforge/database';
import { prisma } from '@signalforge/database';
import { getTriggerNode, parseWorkflowGraph } from './graph.js';

export interface TriggerFilter {
  campaignId?: string;
  tagId?: string;
  listId?: string;
  country?: string;
}

export interface MatchedWorkflow {
  workflowId: string;
  workflowVersionId: string;
  triggerNodeId: string;
}

function matchesFilters(
  filters: TriggerFilter | undefined,
  event: {
    campaignId?: string | null;
    leadId?: string | null;
    workspaceId: string;
    metadata?: Record<string, unknown>;
  },
): boolean {
  if (!filters) return true;
  if (filters.campaignId && filters.campaignId !== event.campaignId) return false;
  if (filters.country && event.metadata?.country !== filters.country) return false;
  return true;
}

async function matchesTagOrListFilter(
  filters: TriggerFilter | undefined,
  leadId: string | null | undefined,
  workspaceId: string,
): Promise<boolean> {
  if (!filters?.tagId && !filters?.listId) return true;
  if (!leadId) return false;

  if (filters.tagId) {
    const tag = await prisma.leadTag.findFirst({
      where: { leadId, tagId: filters.tagId, lead: { workspaceId } },
    });
    if (!tag) return false;
  }

  if (filters.listId) {
    const member = await prisma.leadListMember.findFirst({
      where: { leadId, listId: filters.listId, lead: { workspaceId } },
    });
    if (!member) return false;
  }

  return true;
}

export async function matchWorkflowsForEvent(event: {
  id: string;
  eventType: WorkflowEventType;
  workspaceId: string;
  leadId?: string | null;
  campaignId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<MatchedWorkflow[]> {
  const workflows = await prisma.workflow.findMany({
    where: {
      workspaceId: event.workspaceId,
      status: 'ACTIVE',
      publishedVersionId: { not: null },
    },
    include: {
      publishedVersion: true,
    },
  });

  const matches: MatchedWorkflow[] = [];

  for (const workflow of workflows) {
    if (!workflow.publishedVersion) continue;
    const graph = parseWorkflowGraph(
      workflow.publishedVersion.nodes,
      workflow.publishedVersion.edges,
    );
    const trigger = getTriggerNode(graph);
    if (!trigger) continue;

    const triggerEventType = trigger.data.eventType as WorkflowEventType | undefined;
    if (triggerEventType !== event.eventType) continue;

    const filters = trigger.data.filters as TriggerFilter | undefined;
    const metadata = (event.payload?.metadata ?? event.payload ?? {}) as Record<string, unknown>;

    if (!matchesFilters(filters, { ...event, metadata })) continue;
    if (!(await matchesTagOrListFilter(filters, event.leadId, event.workspaceId))) continue;

    matches.push({
      workflowId: workflow.id,
      workflowVersionId: workflow.publishedVersion.id,
      triggerNodeId: trigger.id,
    });
  }

  return matches;
}
