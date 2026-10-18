import type { WorkflowEventType } from '@signalforge/database';
import {
  ACTION_PRODUCED_EVENTS,
  getNodeById,
  getOutgoingEdges,
  getTriggerNode,
  parseWorkflowGraph,
} from './graph.js';
import type { WorkflowGraph, WorkflowNodeType } from './types.js';

export interface ValidationError {
  code: string;
  message: string;
  nodeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const REQUIRED_CONFIG: Partial<Record<WorkflowNodeType, string[]>> = {
  TRIGGER: ['eventType'],
  ADD_TO_CAMPAIGN: ['campaignId'],
  REMOVE_FROM_CAMPAIGN: ['campaignId'],
  SEND_EMAIL: ['campaignId'],
  SEND_SEQUENCE: ['campaignId'],
  ADD_TAG: ['tagId'],
  REMOVE_TAG: ['tagId'],
  ADD_TO_LIST: ['listId'],
  REMOVE_FROM_LIST: ['listId'],
  UPDATE_LEAD: ['field', 'value'],
  NOTIFY_USER: ['title', 'body'],
  DELAY: ['amount', 'unit'],
  CONDITION: ['logic', 'rules'],
};

function hasDelayBetween(graph: WorkflowGraph, fromId: string, toId: string): boolean {
  const visited = new Set<string>();
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = getNodeById(graph, current);
    if (!node) continue;
    if (node.type === 'DELAY') return true;
    if (current === toId) continue;
    for (const edge of getOutgoingEdges(graph, current)) {
      queue.push(edge.target);
    }
  }
  return false;
}

function detectSelfTriggerLoop(graph: WorkflowGraph): ValidationError[] {
  const trigger = getTriggerNode(graph);
  if (!trigger) return [];
  const triggerEvent = trigger.data.eventType as WorkflowEventType | undefined;
  if (!triggerEvent) return [];

  const errors: ValidationError[] = [];
  for (const node of graph.nodes) {
    if (node.type === 'TRIGGER' || node.type === 'DELAY' || node.type === 'CONDITION') continue;
    const produced = ACTION_PRODUCED_EVENTS[node.type as WorkflowNodeType] ?? [];
    if (!produced.includes(triggerEvent)) continue;
    if (!hasDelayBetween(graph, node.id, trigger.id)) {
      errors.push({
        code: 'SELF_TRIGGER_LOOP',
        message: `Node ${node.id} can produce ${triggerEvent} without a delay before the trigger`,
        nodeId: node.id,
      });
    }
  }
  return errors;
}

function validateRequiredConfig(graph: WorkflowGraph): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const node of graph.nodes) {
    const required = REQUIRED_CONFIG[node.type as WorkflowNodeType];
    if (!required) continue;
    for (const field of required) {
      const value = node.data[field];
      if (value === undefined || value === null || value === '') {
        errors.push({
          code: 'MISSING_CONFIG',
          message: `Node ${node.id} (${node.type}) requires ${field}`,
          nodeId: node.id,
        });
      }
    }
    if (node.type === 'CONDITION') {
      const rules = node.data.rules;
      if (!Array.isArray(rules) || rules.length === 0) {
        errors.push({
          code: 'MISSING_CONFIG',
          message: `Condition node ${node.id} requires at least one rule`,
          nodeId: node.id,
        });
      }
    }
  }
  return errors;
}

function validateConnectivity(graph: WorkflowGraph): ValidationError[] {
  const errors: ValidationError[] = [];
  const triggers = graph.nodes.filter((n) => n.type === 'TRIGGER');
  if (triggers.length !== 1) {
    errors.push({
      code: 'TRIGGER_COUNT',
      message: 'Workflow must have exactly one trigger node',
    });
  }

  const reachable = new Set<string>();
  const trigger = getTriggerNode(graph);
  if (trigger) {
    const queue = [trigger.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const edge of getOutgoingEdges(graph, id)) {
        queue.push(edge.target);
      }
    }
  }

  for (const node of graph.nodes) {
    if (node.type === 'TRIGGER') continue;
    if (!reachable.has(node.id)) {
      errors.push({
        code: 'ORPHAN_NODE',
        message: `Node ${node.id} is not reachable from trigger`,
        nodeId: node.id,
      });
    }
  }

  for (const node of graph.nodes) {
    if (node.type === 'STOP_WORKFLOW') continue;
    const outgoing = getOutgoingEdges(graph, node.id);
    if (node.type === 'CONDITION') {
      const hasYes = outgoing.some((e) => (e.sourceHandle ?? 'default') === 'yes');
      const hasNo = outgoing.some((e) => (e.sourceHandle ?? 'default') === 'no');
      if (!hasYes && !hasNo) {
        errors.push({
          code: 'MISSING_BRANCH',
          message: `Condition node ${node.id} must have yes/no branches`,
          nodeId: node.id,
        });
      }
    } else if (outgoing.length === 0 && node.type !== 'TRIGGER') {
      errors.push({
        code: 'DEAD_END',
        message: `Node ${node.id} has no outgoing edges`,
        nodeId: node.id,
      });
    }
  }

  return errors;
}

export function validateWorkflowGraph(nodes: unknown, edges: unknown): ValidationResult {
  let graph: WorkflowGraph;
  try {
    graph = parseWorkflowGraph(nodes, edges);
  } catch (err) {
    return {
      valid: false,
      errors: [{ code: 'INVALID_GRAPH', message: err instanceof Error ? err.message : 'Invalid graph' }],
    };
  }

  const errors = [
    ...validateConnectivity(graph),
    ...validateRequiredConfig(graph),
    ...detectSelfTriggerLoop(graph),
  ];

  return { valid: errors.length === 0, errors };
}
