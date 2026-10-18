import { describe, expect, it } from 'vitest';
import {
  parseWorkflowGraph,
  getTriggerNode,
  getNodeById,
  getOutgoingEdges,
  getNextNodeId,
  getNodeCategory,
  ACTION_PRODUCED_EVENTS,
  workflowGraphSchema,
  workflowEdgeHandleSchema,
  workflowNodeTypeSchema,
} from './graph.js';
import type { WorkflowGraph } from './types.js';

function makeGraph(overrides?: Partial<WorkflowGraph>): WorkflowGraph {
  return {
    nodes: [
      { id: 'trigger', type: 'TRIGGER', position: { x: 0, y: 0 }, data: { eventType: 'LEAD_CREATED' } },
      { id: 'action1', type: 'NOTIFY_USER', position: { x: 0, y: 100 }, data: { title: 'Hi', body: 'Hello' } },
      { id: 'stop', type: 'STOP_WORKFLOW', position: { x: 0, y: 200 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'action1' },
      { id: 'e2', source: 'action1', target: 'stop' },
    ],
    ...overrides,
  };
}

describe('parseWorkflowGraph', () => {
  it('parses valid nodes and edges', () => {
    const graph = parseWorkflowGraph(
      [{ id: 'n1', type: 'TRIGGER', position: { x: 0, y: 0 }, data: {} }],
      [{ id: 'e1', source: 'n1', target: 'n2' }],
    );
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(1);
  });

  it('throws on invalid node type', () => {
    expect(() =>
      parseWorkflowGraph(
        [{ id: 'n1', type: 'INVALID_TYPE', position: { x: 0, y: 0 }, data: {} }],
        [],
      ),
    ).toThrow();
  });

  it('throws on missing node id', () => {
    expect(() =>
      parseWorkflowGraph(
        [{ id: '', type: 'TRIGGER', position: { x: 0, y: 0 }, data: {} }],
        [],
      ),
    ).toThrow();
  });

  it('throws on missing edge source', () => {
    expect(() =>
      parseWorkflowGraph(
        [{ id: 'n1', type: 'TRIGGER', position: { x: 0, y: 0 }, data: {} }],
        [{ id: 'e1', source: '', target: 'n1' }],
      ),
    ).toThrow();
  });

  it('throws on non-array nodes', () => {
    expect(() => parseWorkflowGraph('not-an-array', [])).toThrow();
  });

  it('throws on null input', () => {
    expect(() => parseWorkflowGraph(null, null)).toThrow();
  });

  it('defaults data to empty object when omitted', () => {
    const graph = parseWorkflowGraph(
      [{ id: 'n1', type: 'TRIGGER', position: { x: 0, y: 0 } }],
      [],
    );
    expect(graph.nodes[0]!.data).toEqual({});
  });

  it('parses edges with sourceHandle', () => {
    const graph = parseWorkflowGraph(
      [{ id: 'n1', type: 'CONDITION', position: { x: 0, y: 0 }, data: {} }],
      [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'yes' },
        { id: 'e2', source: 'n1', target: 'n3', sourceHandle: 'no' },
      ],
    );
    expect(graph.edges[0]!.sourceHandle).toBe('yes');
    expect(graph.edges[1]!.sourceHandle).toBe('no');
  });

  it('rejects invalid sourceHandle value', () => {
    expect(() =>
      parseWorkflowGraph(
        [{ id: 'n1', type: 'TRIGGER', position: { x: 0, y: 0 }, data: {} }],
        [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'bogus' }],
      ),
    ).toThrow();
  });

  it('parses empty graph', () => {
    const graph = parseWorkflowGraph([], []);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });
});

describe('getTriggerNode', () => {
  it('returns the trigger node', () => {
    const graph = makeGraph();
    const trigger = getTriggerNode(graph);
    expect(trigger).toBeDefined();
    expect(trigger!.type).toBe('TRIGGER');
    expect(trigger!.id).toBe('trigger');
  });

  it('returns undefined if no trigger node', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'action1', type: 'NOTIFY_USER', position: { x: 0, y: 0 }, data: { title: 'Hi', body: 'Hello' } },
      ],
    });
    expect(getTriggerNode(graph)).toBeUndefined();
  });

  it('returns the first trigger if multiple exist', () => {
    const graph = makeGraph({
      nodes: [
        { id: 't1', type: 'TRIGGER', position: { x: 0, y: 0 }, data: {} },
        { id: 't2', type: 'TRIGGER', position: { x: 0, y: 100 }, data: {} },
      ],
    });
    expect(getTriggerNode(graph)!.id).toBe('t1');
  });
});

describe('getNodeById', () => {
  it('returns the matching node', () => {
    const graph = makeGraph();
    const node = getNodeById(graph, 'action1');
    expect(node).toBeDefined();
    expect(node!.type).toBe('NOTIFY_USER');
  });

  it('returns undefined for non-existent id', () => {
    const graph = makeGraph();
    expect(getNodeById(graph, 'non-existent')).toBeUndefined();
  });
});

describe('getOutgoingEdges', () => {
  it('returns outgoing edges for a node', () => {
    const graph = makeGraph();
    const edges = getOutgoingEdges(graph, 'trigger');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.target).toBe('action1');
  });

  it('returns empty array for node with no outgoing edges', () => {
    const graph = makeGraph();
    expect(getOutgoingEdges(graph, 'stop')).toEqual([]);
  });

  it('filters by handle when specified', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'cond', type: 'CONDITION', position: { x: 0, y: 0 }, data: { logic: 'AND', rules: [] } },
        { id: 'yes-target', type: 'NOTIFY_USER', position: { x: 0, y: 100 }, data: {} },
        { id: 'no-target', type: 'STOP_WORKFLOW', position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'cond', target: 'yes-target', sourceHandle: 'yes' },
        { id: 'e2', source: 'cond', target: 'no-target', sourceHandle: 'no' },
      ],
    };
    const yesEdges = getOutgoingEdges(graph, 'cond', 'yes');
    expect(yesEdges).toHaveLength(1);
    expect(yesEdges[0]!.target).toBe('yes-target');

    const noEdges = getOutgoingEdges(graph, 'cond', 'no');
    expect(noEdges).toHaveLength(1);
    expect(noEdges[0]!.target).toBe('no-target');
  });

  it('returns all edges when handle is undefined', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'cond', type: 'CONDITION', position: { x: 0, y: 0 }, data: {} },
        { id: 'a', type: 'NOTIFY_USER', position: { x: 0, y: 100 }, data: {} },
        { id: 'b', type: 'STOP_WORKFLOW', position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'cond', target: 'a', sourceHandle: 'yes' },
        { id: 'e2', source: 'cond', target: 'b', sourceHandle: 'no' },
      ],
    };
    expect(getOutgoingEdges(graph, 'cond')).toHaveLength(2);
  });

  it('treats missing sourceHandle as default', () => {
    const graph = makeGraph();
    const edges = getOutgoingEdges(graph, 'trigger', 'default');
    expect(edges).toHaveLength(1);
  });
});

describe('getNextNodeId', () => {
  it('returns the next node id on default handle', () => {
    const graph = makeGraph();
    expect(getNextNodeId(graph, 'trigger')).toBe('action1');
    expect(getNextNodeId(graph, 'action1')).toBe('stop');
  });

  it('returns undefined for terminal node', () => {
    const graph = makeGraph();
    expect(getNextNodeId(graph, 'stop')).toBeUndefined();
  });

  it('returns undefined for non-existent node', () => {
    const graph = makeGraph();
    expect(getNextNodeId(graph, 'does-not-exist')).toBeUndefined();
  });

  it('follows specific handle for condition nodes', () => {
    const graph: WorkflowGraph = {
      nodes: [
        { id: 'cond', type: 'CONDITION', position: { x: 0, y: 0 }, data: {} },
        { id: 'yes-node', type: 'NOTIFY_USER', position: { x: 0, y: 100 }, data: {} },
        { id: 'no-node', type: 'STOP_WORKFLOW', position: { x: 0, y: 200 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'cond', target: 'yes-node', sourceHandle: 'yes' },
        { id: 'e2', source: 'cond', target: 'no-node', sourceHandle: 'no' },
      ],
    };
    expect(getNextNodeId(graph, 'cond', 'yes')).toBe('yes-node');
    expect(getNextNodeId(graph, 'cond', 'no')).toBe('no-node');
  });
});

describe('getNodeCategory', () => {
  it('returns TRIGGER for TRIGGER type', () => {
    expect(getNodeCategory('TRIGGER')).toBe('TRIGGER');
  });

  it('returns LOGIC for CONDITION type', () => {
    expect(getNodeCategory('CONDITION')).toBe('LOGIC');
  });

  it('returns TIMING for DELAY type', () => {
    expect(getNodeCategory('DELAY')).toBe('TIMING');
  });

  it('returns ACTION for action node types', () => {
    const actionTypes = [
      'VERIFY_EMAIL', 'QUALIFY_LEAD', 'ADD_TO_CAMPAIGN', 'REMOVE_FROM_CAMPAIGN',
      'SEND_EMAIL', 'SEND_SEQUENCE', 'ADD_TAG', 'REMOVE_TAG', 'ADD_TO_LIST',
      'REMOVE_FROM_LIST', 'UPDATE_LEAD', 'NOTIFY_USER', 'PAUSE_LEAD', 'STOP_WORKFLOW',
    ] as const;
    for (const t of actionTypes) {
      expect(getNodeCategory(t)).toBe('ACTION');
    }
  });
});

describe('ACTION_PRODUCED_EVENTS', () => {
  it('maps action types to produced events', () => {
    expect(ACTION_PRODUCED_EVENTS.UPDATE_LEAD).toContain('LEAD_QUALIFIED');
    expect(ACTION_PRODUCED_EVENTS.QUALIFY_LEAD).toContain('LEAD_QUALIFIED');
    expect(ACTION_PRODUCED_EVENTS.VERIFY_EMAIL).toContain('LEAD_VERIFIED');
    expect(ACTION_PRODUCED_EVENTS.ADD_TO_CAMPAIGN).toContain('CAMPAIGN_STARTED');
    expect(ACTION_PRODUCED_EVENTS.SEND_EMAIL).toContain('EMAIL_SENT');
    expect(ACTION_PRODUCED_EVENTS.SEND_SEQUENCE).toContain('EMAIL_SENT');
  });

  it('returns undefined for types that do not produce events', () => {
    expect(ACTION_PRODUCED_EVENTS.NOTIFY_USER).toBeUndefined();
    expect(ACTION_PRODUCED_EVENTS.STOP_WORKFLOW).toBeUndefined();
  });
});

describe('Zod schemas', () => {
  it('workflowNodeTypeSchema accepts all valid types', () => {
    const types = [
      'TRIGGER', 'VERIFY_EMAIL', 'QUALIFY_LEAD', 'ADD_TO_CAMPAIGN', 'REMOVE_FROM_CAMPAIGN',
      'SEND_EMAIL', 'SEND_SEQUENCE', 'ADD_TAG', 'REMOVE_TAG', 'ADD_TO_LIST', 'REMOVE_FROM_LIST',
      'UPDATE_LEAD', 'NOTIFY_USER', 'PAUSE_LEAD', 'STOP_WORKFLOW', 'CONDITION', 'DELAY',
    ];
    for (const t of types) {
      expect(workflowNodeTypeSchema.parse(t)).toBe(t);
    }
  });

  it('workflowEdgeHandleSchema accepts valid handles', () => {
    for (const h of ['default', 'yes', 'no', 'success', 'failure']) {
      expect(workflowEdgeHandleSchema.parse(h)).toBe(h);
    }
  });

  it('workflowGraphSchema validates a full graph', () => {
    const result = workflowGraphSchema.safeParse({
      nodes: [{ id: 'n1', type: 'TRIGGER', position: { x: 0, y: 0 } }],
      edges: [],
    });
    expect(result.success).toBe(true);
  });
});
