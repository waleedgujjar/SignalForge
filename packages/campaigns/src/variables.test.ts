import { describe, expect, it } from 'vitest';
import { CAMPAIGN_VARIABLE_GROUPS, normalizeVariableKey } from './variables.js';

describe('CAMPAIGN_VARIABLE_GROUPS', () => {
  it('has expected groups', () => {
    const labels = CAMPAIGN_VARIABLE_GROUPS.map((g) => g.label);
    expect(labels).toContain('Lead');
    expect(labels).toContain('Scores');
    expect(labels).toContain('Enrichment');
    expect(labels).toContain('AI Intelligence');
    expect(labels).toContain('Research');
  });

  it('has variables with key, label, and example in each group', () => {
    for (const group of CAMPAIGN_VARIABLE_GROUPS) {
      expect(group.variables.length).toBeGreaterThan(0);
      for (const v of group.variables) {
        expect(v.key).toBeTruthy();
        expect(v.label).toBeTruthy();
        expect(v.example).toContain('{{');
      }
    }
  });

  it('Lead group contains essential lead fields', () => {
    const leadGroup = CAMPAIGN_VARIABLE_GROUPS.find((g) => g.label === 'Lead')!;
    const keys = leadGroup.variables.map((v) => v.key);
    expect(keys).toContain('first_name');
    expect(keys).toContain('last_name');
    expect(keys).toContain('email');
    expect(keys).toContain('company');
  });
});

describe('normalizeVariableKey', () => {
  it('converts camelCase to snake_case via alias map', () => {
    expect(normalizeVariableKey('firstName')).toBe('first_name');
    expect(normalizeVariableKey('lastName')).toBe('last_name');
    expect(normalizeVariableKey('fullName')).toBe('full_name');
    expect(normalizeVariableKey('companyDomain')).toBe('company_domain');
    expect(normalizeVariableKey('jobTitle')).toBe('job_title');
    expect(normalizeVariableKey('icpScore')).toBe('icp_score');
    expect(normalizeVariableKey('websiteScore')).toBe('website_score');
    expect(normalizeVariableKey('prospectScore')).toBe('prospect_score');
  });

  it('returns unknown keys unchanged', () => {
    expect(normalizeVariableKey('first_name')).toBe('first_name');
    expect(normalizeVariableKey('email')).toBe('email');
    expect(normalizeVariableKey('custom_field')).toBe('custom_field');
  });
});
