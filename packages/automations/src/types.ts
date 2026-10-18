import type { WorkflowEventType, WorkflowNodeErrorCategory } from '@signalforge/database';

export type WorkflowNodeCategory = 'TRIGGER' | 'ACTION' | 'LOGIC' | 'TIMING';

export type WorkflowNodeType =
  | 'TRIGGER'
  | 'VERIFY_EMAIL'
  | 'QUALIFY_LEAD'
  | 'ADD_TO_CAMPAIGN'
  | 'REMOVE_FROM_CAMPAIGN'
  | 'SEND_EMAIL'
  | 'SEND_SEQUENCE'
  | 'ADD_TAG'
  | 'REMOVE_TAG'
  | 'ADD_TO_LIST'
  | 'REMOVE_FROM_LIST'
  | 'UPDATE_LEAD'
  | 'NOTIFY_USER'
  | 'PAUSE_LEAD'
  | 'STOP_WORKFLOW'
  | 'CONDITION'
  | 'DELAY';

export type WorkflowEdgeHandle = 'default' | 'yes' | 'no' | 'success' | 'failure';

export interface WorkflowGraphNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: WorkflowEdgeHandle;
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface PublishWorkflowEventInput {
  eventType: WorkflowEventType;
  workspaceId: string;
  leadId?: string;
  campaignId?: string;
  mailboxId?: string;
  conversationId?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowContext {
  leadId: string;
  workspaceId: string;
  campaignId?: string;
  mailboxId?: string;
  conversationId?: string;
  triggerEventType?: WorkflowEventType;
  metadata?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  errorCategory?: WorkflowNodeErrorCategory;
  branch?: WorkflowEdgeHandle;
}

export const TERMINAL_EXECUTION_STATUSES = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export const ACTIVE_EXECUTION_STATUSES = ['RUNNING', 'WAITING', 'PAUSED'] as const;

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'less_than'
  | 'in'
  | 'not_in';

export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export interface ConditionConfig {
  logic: 'AND' | 'OR';
  rules: ConditionRule[];
}
