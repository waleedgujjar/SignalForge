import { describe, expect, it } from 'vitest';
import { WORKFLOW_TEMPLATES } from './templates.js';

describe('WORKFLOW_TEMPLATES', () => {
  it('contains at least one template', () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('each template has required fields', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.graph).toBeDefined();
      expect(Array.isArray(template.graph.nodes)).toBe(true);
      expect(Array.isArray(template.graph.edges)).toBe(true);
    }
  });

  it('each template has unique id', () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each template graph has a trigger node', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const triggers = template.graph.nodes.filter((n) => n.type === 'TRIGGER');
      expect(triggers).toHaveLength(1);
    }
  });

  it('all edges reference existing nodes', () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const nodeIds = new Set(template.graph.nodes.map((n) => n.id));
      for (const edge of template.graph.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      }
    }
  });

  it('contains known templates', () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('new-lead-outreach');
    expect(ids).toContain('positive-reply');
    expect(ids).toContain('bounce-protection');
    expect(ids).toContain('meeting-booked');
  });

  it('new-lead-outreach template has correct structure', () => {
    const tmpl = WORKFLOW_TEMPLATES.find((t) => t.id === 'new-lead-outreach')!;
    expect(tmpl.graph.nodes).toHaveLength(5);
    expect(tmpl.graph.edges).toHaveLength(4);
    const types = tmpl.graph.nodes.map((n) => n.type);
    expect(types).toContain('TRIGGER');
    expect(types).toContain('VERIFY_EMAIL');
    expect(types).toContain('QUALIFY_LEAD');
    expect(types).toContain('DELAY');
    expect(types).toContain('ADD_TO_CAMPAIGN');
  });

  it('bounce-protection template ends with STOP_WORKFLOW', () => {
    const tmpl = WORKFLOW_TEMPLATES.find((t) => t.id === 'bounce-protection')!;
    const lastEdge = tmpl.graph.edges[tmpl.graph.edges.length - 1]!;
    const lastNode = tmpl.graph.nodes.find((n) => n.id === lastEdge.target);
    expect(lastNode!.type).toBe('STOP_WORKFLOW');
  });
});
