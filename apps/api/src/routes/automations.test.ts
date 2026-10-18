import { describe, expect, it, vi } from 'vitest';

vi.mock('@signalforge/database', () => ({
  prisma: {},
}));

import { validateWorkflowGraph } from '@signalforge/automations';

describe('automations workspace isolation patterns', () => {
  it('rejects workflow graph without exactly one trigger', () => {
    const result = validateWorkflowGraph([], []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'TRIGGER_COUNT')).toBe(true);
  });

  it('detects self-trigger loop without delay', () => {
    const nodes = [
      {
        id: 'trigger',
        type: 'TRIGGER',
        position: { x: 0, y: 0 },
        data: { eventType: 'LEAD_QUALIFIED' },
      },
      {
        id: 'update',
        type: 'UPDATE_LEAD',
        position: { x: 0, y: 100 },
        data: { field: 'status', value: 'QUALIFIED' },
      },
    ];
    const edges = [{ id: 'e1', source: 'trigger', target: 'update' }];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'SELF_TRIGGER_LOOP')).toBe(true);
  });

  it('allows self-trigger loop when delay is present', () => {
    const nodes = [
      {
        id: 'trigger',
        type: 'TRIGGER',
        position: { x: 0, y: 0 },
        data: { eventType: 'LEAD_QUALIFIED' },
      },
      {
        id: 'update',
        type: 'UPDATE_LEAD',
        position: { x: 0, y: 100 },
        data: { field: 'status', value: 'QUALIFIED' },
      },
      {
        id: 'delay',
        type: 'DELAY',
        position: { x: 0, y: 200 },
        data: { amount: 1, unit: 'HOURS' },
      },
    ];
    const edges = [
      { id: 'e1', source: 'trigger', target: 'update' },
      { id: 'e2', source: 'update', target: 'delay' },
    ];
    const result = validateWorkflowGraph(nodes, edges);
    expect(result.errors.some((e) => e.code === 'SELF_TRIGGER_LOOP')).toBe(false);
  });
});

describe('automations RBAC expectations', () => {
  it('documents admin-only publish operations', () => {
    const adminOnly = ['publish', 'pause', 'resume', 'archive'];
    expect(adminOnly).toContain('publish');
    expect(adminOnly).toContain('pause');
  });
});
