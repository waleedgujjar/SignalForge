import { describe, expect, it, vi } from 'vitest';

vi.mock('@signalforge/database', () => ({
  prisma: {},
}));

import { evaluateCondition, evaluateRule } from './conditions.js';
import { calculateResumeAt } from './delay.js';
import { validateWorkflowGraph } from './validation.js';
import { hasExceededStepLimit, isExecutionExpired } from './limits.js';

// ─── helpers ───

function triggerNode(id = 'trigger', eventType = 'LEAD_CREATED') {
  return { id, type: 'TRIGGER', position: { x: 0, y: 0 }, data: { eventType } };
}

function actionNode(id: string, type: string, data: Record<string, unknown> = {}, y = 100) {
  return { id, type, position: { x: 0, y }, data };
}

function stopNode(id = 'stop', y = 300) {
  return { id, type: 'STOP_WORKFLOW', position: { x: 0, y }, data: { label: 'Stop' } };
}

function conditionNode(id = 'cond', y = 100) {
  return { id, type: 'CONDITION', position: { x: 0, y }, data: { logic: 'AND', rules: [{ field: 'a', operator: 'equals', value: '1' }] } };
}

function delayNode(id = 'delay', y = 100) {
  return { id, type: 'DELAY', position: { x: 0, y }, data: { amount: 1, unit: 'HOURS' } };
}

function edge(id: string, source: string, target: string, sourceHandle?: string) {
  return { id, source, target, ...(sourceHandle ? { sourceHandle } : {}) };
}

// ─── validation tests ───

describe('validateWorkflowGraph', () => {
  it('validates a simple valid workflow', () => {
    const nodes = [
      triggerNode(),
      actionNode('notify', 'NOTIFY_USER', { title: 'Hi', body: 'Hello' }),
      stopNode(),
    ];
    const edges = [edge('e1', 'trigger', 'notify'), edge('e2', 'notify', 'stop')];
    expect(validateWorkflowGraph(nodes, edges).valid).toBe(true);
  });

  it('returns INVALID_GRAPH for completely invalid input', () => {
    const result = validateWorkflowGraph('not-valid', null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.code).toBe('INVALID_GRAPH');
  });

  describe('trigger count', () => {
    it('fails when there are zero trigger nodes', () => {
      const nodes = [
        actionNode('a', 'NOTIFY_USER', { title: 'Hi', body: 'Hello' }),
        stopNode(),
      ];
      const edges = [edge('e1', 'a', 'stop')];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'TRIGGER_COUNT')).toBe(true);
    });

    it('fails when there are multiple trigger nodes', () => {
      const nodes = [
        triggerNode('t1'),
        triggerNode('t2'),
        stopNode(),
      ];
      const edges = [
        edge('e1', 't1', 'stop'),
        edge('e2', 't2', 'stop'),
      ];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'TRIGGER_COUNT')).toBe(true);
    });
  });

  describe('orphan nodes', () => {
    it('detects unreachable nodes', () => {
      const nodes = [
        triggerNode(),
        actionNode('connected', 'NOTIFY_USER', { title: 'Hi', body: 'Hello' }),
        stopNode(),
        actionNode('orphan', 'NOTIFY_USER', { title: 'Orphan', body: 'Alone' }, 400),
      ];
      const edges = [
        edge('e1', 'trigger', 'connected'),
        edge('e2', 'connected', 'stop'),
      ];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'ORPHAN_NODE' && e.nodeId === 'orphan')).toBe(true);
    });
  });

  describe('dead ends', () => {
    it('detects nodes with no outgoing edges', () => {
      const nodes = [
        triggerNode(),
        actionNode('deadend', 'NOTIFY_USER', { title: 'Hi', body: 'Hello' }),
      ];
      const edges = [edge('e1', 'trigger', 'deadend')];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'DEAD_END' && e.nodeId === 'deadend')).toBe(true);
    });

    it('does not flag STOP_WORKFLOW as dead end', () => {
      const nodes = [
        triggerNode(),
        stopNode(),
      ];
      const edges = [edge('e1', 'trigger', 'stop')];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.some((e) => e.code === 'DEAD_END')).toBe(false);
    });
  });

  describe('condition branches', () => {
    it('fails when condition node has no yes/no branches', () => {
      const nodes = [
        triggerNode(),
        conditionNode(),
        stopNode(),
      ];
      const edges = [
        edge('e1', 'trigger', 'cond'),
        edge('e2', 'cond', 'stop'), // no sourceHandle
      ];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'MISSING_BRANCH')).toBe(true);
    });

    it('passes when condition has yes and no branches', () => {
      const nodes = [
        triggerNode(),
        conditionNode(),
        actionNode('yes-action', 'NOTIFY_USER', { title: 'Yes', body: 'Y' }, 200),
        actionNode('no-action', 'NOTIFY_USER', { title: 'No', body: 'N' }, 200),
        stopNode('stop1', 300),
        stopNode('stop2', 300),
      ];
      const edges = [
        edge('e1', 'trigger', 'cond'),
        edge('e2', 'cond', 'yes-action', 'yes'),
        edge('e3', 'cond', 'no-action', 'no'),
        edge('e4', 'yes-action', 'stop1'),
        edge('e5', 'no-action', 'stop2'),
      ];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.valid).toBe(true);
    });
  });

  describe('required config', () => {
    it('detects missing eventType on trigger', () => {
      const nodes = [
        { id: 'trigger', type: 'TRIGGER', position: { x: 0, y: 0 }, data: {} },
        stopNode(),
      ];
      const edges = [edge('e1', 'trigger', 'stop')];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.some((e) => e.code === 'MISSING_CONFIG' && e.nodeId === 'trigger')).toBe(true);
    });

    it('detects missing campaignId on ADD_TO_CAMPAIGN', () => {
      const nodes = [
        triggerNode(),
        actionNode('add', 'ADD_TO_CAMPAIGN', {}),
        stopNode(),
      ];
      const edges = [edge('e1', 'trigger', 'add'), edge('e2', 'add', 'stop')];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.some((e) => e.code === 'MISSING_CONFIG' && e.nodeId === 'add')).toBe(true);
    });

    it('detects missing tagId on ADD_TAG', () => {
      const nodes = [
        triggerNode(),
        actionNode('tag', 'ADD_TAG', {}),
        stopNode(),
      ];
      const edges = [edge('e1', 'trigger', 'tag'), edge('e2', 'tag', 'stop')];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.some((e) => e.code === 'MISSING_CONFIG' && e.nodeId === 'tag')).toBe(true);
    });

    it('detects missing listId on ADD_TO_LIST', () => {
      const nodes = [
        triggerNode(),
        actionNode('list', 'ADD_TO_LIST', {}),
        stopNode(),
      ];
      const edges = [edge('e1', 'trigger', 'list'), edge('e2', 'list', 'stop')];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.some((e) => e.code === 'MISSING_CONFIG' && e.nodeId === 'list')).toBe(true);
    });

    it('detects missing field and value on UPDATE_LEAD', () => {
      const nodes = [
        triggerNode(),
        actionNode('upd', 'UPDATE_LEAD', {}),
        stopNode(),
      ];
      const edges = [edge('e1', 'trigger', 'upd'), edge('e2', 'upd', 'stop')];
      const result = validateWorkflowGraph(nodes, edges);
      const updErrors = result.errors.filter((e) => e.nodeId === 'upd');
      expect(updErrors.length).toBeGreaterThanOrEqual(2);
    });

    it('detects missing title and body on NOTIFY_USER', () => {
      const nodes = [
        triggerNode(),
        actionNode('notify', 'NOTIFY_USER', {}),
        stopNode(),
      ];
      const edges = [edge('e1', 'trigger', 'notify'), edge('e2', 'notify', 'stop')];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.some((e) => e.nodeId === 'notify')).toBe(true);
    });

    it('detects missing amount and unit on DELAY', () => {
      const nodes = [
        triggerNode(),
        { id: 'delay', type: 'DELAY', position: { x: 0, y: 100 }, data: {} },
        stopNode(),
      ];
      const edges = [edge('e1', 'trigger', 'delay'), edge('e2', 'delay', 'stop')];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.some((e) => e.nodeId === 'delay' && e.code === 'MISSING_CONFIG')).toBe(true);
    });

    it('detects empty rules on CONDITION', () => {
      const nodes = [
        triggerNode(),
        { id: 'cond', type: 'CONDITION', position: { x: 0, y: 100 }, data: { logic: 'AND', rules: [] } },
        stopNode('s1', 200),
        stopNode('s2', 200),
      ];
      const edges = [
        edge('e1', 'trigger', 'cond'),
        edge('e2', 'cond', 's1', 'yes'),
        edge('e3', 'cond', 's2', 'no'),
      ];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.some((e) => e.nodeId === 'cond' && e.code === 'MISSING_CONFIG')).toBe(true);
    });

    it('passes valid required config', () => {
      const nodes = [
        triggerNode(),
        actionNode('tag', 'ADD_TAG', { tagId: 'tag1' }),
        stopNode(),
      ];
      const edges = [edge('e1', 'trigger', 'tag'), edge('e2', 'tag', 'stop')];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.filter((e) => e.code === 'MISSING_CONFIG')).toHaveLength(0);
    });
  });

  describe('self-trigger loop detection', () => {
    it('detects self-trigger loop without delay', () => {
      const nodes = [
        triggerNode('trigger', 'LEAD_QUALIFIED'),
        actionNode('qualify', 'QUALIFY_LEAD', {}),
        stopNode(),
      ];
      const edges = [
        edge('e1', 'trigger', 'qualify'),
        edge('e2', 'qualify', 'stop'),
      ];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.some((e) => e.code === 'SELF_TRIGGER_LOOP')).toBe(true);
    });

    it('does not flag self-trigger loop with delay after action', () => {
      const nodes = [
        triggerNode('trigger', 'LEAD_QUALIFIED'),
        actionNode('qualify', 'QUALIFY_LEAD', {}),
        delayNode('delay1', 200),
        stopNode('stop', 300),
      ];
      const edges = [
        edge('e1', 'trigger', 'qualify'),
        edge('e2', 'qualify', 'delay1'),
        edge('e3', 'delay1', 'stop'),
      ];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.some((e) => e.code === 'SELF_TRIGGER_LOOP')).toBe(false);
    });

    it('does not flag when action does not produce trigger event', () => {
      const nodes = [
        triggerNode('trigger', 'LEAD_CREATED'),
        actionNode('notify', 'NOTIFY_USER', { title: 'Hi', body: 'Hello' }),
        stopNode(),
      ];
      const edges = [
        edge('e1', 'trigger', 'notify'),
        edge('e2', 'notify', 'stop'),
      ];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.errors.some((e) => e.code === 'SELF_TRIGGER_LOOP')).toBe(false);
    });
  });

  describe('empty workflow', () => {
    it('fails with no nodes', () => {
      const result = validateWorkflowGraph([], []);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'TRIGGER_COUNT')).toBe(true);
    });
  });

  describe('complex workflows', () => {
    it('validates a workflow with delay, condition, and multiple actions', () => {
      const nodes = [
        triggerNode(),
        delayNode('d1', 100),
        conditionNode('c1', 200),
        actionNode('yes-act', 'ADD_TAG', { tagId: 'tag1' }, 300),
        actionNode('no-act', 'NOTIFY_USER', { title: 'Nope', body: 'No match' }, 300),
        stopNode('s1', 400),
        stopNode('s2', 400),
      ];
      const edges = [
        edge('e1', 'trigger', 'd1'),
        edge('e2', 'd1', 'c1'),
        edge('e3', 'c1', 'yes-act', 'yes'),
        edge('e4', 'c1', 'no-act', 'no'),
        edge('e5', 'yes-act', 's1'),
        edge('e6', 'no-act', 's2'),
      ];
      const result = validateWorkflowGraph(nodes, edges);
      expect(result.valid).toBe(true);
    });
  });
});

describe('evaluateCondition', () => {
  it('evaluates AND rules', () => {
    const result = evaluateCondition(
      {
        logic: 'AND',
        rules: [
          { field: 'lead.country', operator: 'equals', value: 'USA' },
          { field: 'lead.status', operator: 'equals', value: 'QUALIFIED' },
        ],
      },
      { lead: { country: 'USA', status: 'QUALIFIED' } },
    );
    expect(result).toBe(true);
  });

  it('evaluates OR rules', () => {
    const result = evaluateCondition(
      {
        logic: 'OR',
        rules: [
          { field: 'lead.country', operator: 'equals', value: 'USA' },
          { field: 'lead.country', operator: 'equals', value: 'UK' },
        ],
      },
      { lead: { country: 'UK' } },
    );
    expect(result).toBe(true);
  });
});

describe('evaluateRule operators', () => {
  it('supports contains and not_equals', () => {
    expect(evaluateRule({ field: 'lead.email', operator: 'contains', value: '@acme' }, { lead: { email: 'a@acme.com' } })).toBe(true);
    expect(evaluateRule({ field: 'lead.status', operator: 'not_equals', value: 'NEW' }, { lead: { status: 'QUALIFIED' } })).toBe(true);
  });
});

describe('calculateResumeAt', () => {
  it('adds hours correctly', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const resume = calculateResumeAt(now, 2, 'HOURS');
    expect(resume.getTime()).toBe(now.getTime() + 2 * 60 * 60 * 1000);
  });
});

describe('execution limits', () => {
  it('detects step and duration limits', () => {
    expect(hasExceededStepLimit(100)).toBe(true);
    expect(isExecutionExpired(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000))).toBe(true);
  });
});
