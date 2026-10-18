import { z } from 'zod';
import type { WorkflowGraph, WorkflowGraphEdge, WorkflowGraphNode, WorkflowNodeType } from './types.js';

export type { WorkflowGraph };

export const workflowNodeTypeSchema = z.enum([
  'TRIGGER',
  'VERIFY_EMAIL',
  'QUALIFY_LEAD',
  'ADD_TO_CAMPAIGN',
  'REMOVE_FROM_CAMPAIGN',
  'SEND_EMAIL',
  'SEND_SEQUENCE',
  'ADD_TAG',
  'REMOVE_TAG',
  'ADD_TO_LIST',
  'REMOVE_FROM_LIST',
  'UPDATE_LEAD',
  'NOTIFY_USER',
  'PAUSE_LEAD',
  'STOP_WORKFLOW',
  'CONDITION',
  'DELAY',
]);

export const workflowEdgeHandleSchema = z.enum(['default', 'yes', 'no', 'success', 'failure']);

export const workflowGraphNodeSchema = z.object({
  id: z.string().min(1),
  type: workflowNodeTypeSchema,
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.unknown()).default({}),
});

export const workflowGraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: workflowEdgeHandleSchema.optional(),
});

export const workflowGraphSchema = z.object({
  nodes: z.array(workflowGraphNodeSchema),
  edges: z.array(workflowGraphEdgeSchema),
});

export function parseWorkflowGraph(nodes: unknown, edges: unknown): WorkflowGraph {
  return workflowGraphSchema.parse({ nodes, edges });
}

export function getTriggerNode(graph: WorkflowGraph): WorkflowGraphNode | undefined {
  return graph.nodes.find((n) => n.type === 'TRIGGER');
}

export function getNodeById(graph: WorkflowGraph, nodeId: string): WorkflowGraphNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId);
}

export function getOutgoingEdges(
  graph: WorkflowGraph,
  nodeId: string,
  handle?: string,
): WorkflowGraphEdge[] {
  return graph.edges.filter((e) => {
    if (e.source !== nodeId) return false;
    if (handle === undefined) return true;
    return (e.sourceHandle ?? 'default') === handle;
  });
}

export function getNextNodeId(
  graph: WorkflowGraph,
  nodeId: string,
  handle: string = 'default',
): string | undefined {
  const edge = getOutgoingEdges(graph, nodeId, handle)[0];
  return edge?.target;
}

export function getNodeCategory(type: WorkflowNodeType): 'TRIGGER' | 'ACTION' | 'LOGIC' | 'TIMING' {
  if (type === 'TRIGGER') return 'TRIGGER';
  if (type === 'CONDITION') return 'LOGIC';
  if (type === 'DELAY') return 'TIMING';
  return 'ACTION';
}

export const ACTION_PRODUCED_EVENTS: Partial<Record<WorkflowNodeType, string[]>> = {
  UPDATE_LEAD: ['LEAD_QUALIFIED'],
  QUALIFY_LEAD: ['LEAD_QUALIFIED'],
  VERIFY_EMAIL: ['LEAD_VERIFIED'],
  ADD_TO_CAMPAIGN: ['CAMPAIGN_STARTED'],
  SEND_EMAIL: ['EMAIL_SENT'],
  SEND_SEQUENCE: ['EMAIL_SENT'],
};
