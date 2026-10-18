import { describe, expect, it } from 'vitest';
import { resolveVariables, validateTemplate, detectVariables, leadToVariableContext } from './variable-resolver.js';

describe('VariableResolver', () => {
  it('detects variables in template', () => {
    expect(detectVariables('Hi {{first_name}}, from {{company}}')).toEqual([
      'first_name',
      'company',
    ]);
  });

  it('resolves variables', () => {
    const result = resolveVariables('Hi {{first_name}}, I noticed {{company}} is growing.', {
      first_name: 'Sarah',
      company: 'Acme',
    });
    expect(result.text).toBe('Hi Sarah, I noticed Acme is growing.');
    expect(result.hasUnresolved).toBe(false);
  });

  it('detects missing variables', () => {
    const result = resolveVariables('Hi {{first_name}}, {{company}} team', {
      first_name: 'Sarah',
    });
    expect(result.hasUnresolved).toBe(true);
    expect(result.missingVariables).toContain('{{company}}');
  });

  it('validates template across fields', () => {
    const validation = validateTemplate(
      'Hello {{first_name}}',
      'About {{company}}',
      { first_name: 'Sarah' },
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it('uses fallback values when primary variable is missing', () => {
    const result = resolveVariables('Hi {{first_name|there}}', {});
    expect(result.text).toBe('Hi there');
    expect(result.hasUnresolved).toBe(false);
  });

  it('resolves camelCase aliases', () => {
    const result = resolveVariables('Score: {{icpScore}}', {
      icp_score: '88',
    });
    expect(result.text).toBe('Score: 88');
  });

  it('maps enrichment and website scores', () => {
    const context = leadToVariableContext({
      email: 'a@b.com',
      enrichment: { icpFitScore: 70, prospectScore: 80, department: 'Sales', seniority: 'MANAGER' },
      websiteAnalysis: { websiteScore: 55 },
    });
    expect(context.icp_score).toBe('70');
    expect(context.prospect_score).toBe('80');
    expect(context.website_score).toBe('55');
    expect(context.department).toBe('Sales');
  });
});
