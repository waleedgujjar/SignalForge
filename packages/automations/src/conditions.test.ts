import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@signalforge/database', () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    suppression: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@signalforge/database';
import { evaluateRule, evaluateCondition, buildLeadConditionContext } from './conditions.js';
import type { ConditionConfig, ConditionRule } from './types.js';

const mockPrisma = prisma as unknown as {
  lead: { findFirst: ReturnType<typeof vi.fn> };
  suppression: { findFirst: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('evaluateRule', () => {
  describe('equals / not_equals', () => {
    it('equals matches identical strings', () => {
      expect(evaluateRule({ field: 'a', operator: 'equals', value: 'x' }, { a: 'x' })).toBe(true);
      expect(evaluateRule({ field: 'a', operator: 'equals', value: 'x' }, { a: 'y' })).toBe(false);
    });

    it('not_equals returns true for different values', () => {
      expect(evaluateRule({ field: 'a', operator: 'not_equals', value: 'x' }, { a: 'y' })).toBe(true);
      expect(evaluateRule({ field: 'a', operator: 'not_equals', value: 'x' }, { a: 'x' })).toBe(false);
    });
  });

  describe('contains / not_contains', () => {
    it('contains is case-insensitive', () => {
      expect(evaluateRule({ field: 'email', operator: 'contains', value: '@ACME' }, { email: 'user@acme.com' })).toBe(true);
    });

    it('not_contains works correctly', () => {
      expect(evaluateRule({ field: 'email', operator: 'not_contains', value: '@acme' }, { email: 'user@other.com' })).toBe(true);
      expect(evaluateRule({ field: 'email', operator: 'not_contains', value: '@acme' }, { email: 'user@acme.com' })).toBe(false);
    });
  });

  describe('starts_with / ends_with', () => {
    it('starts_with is case-insensitive', () => {
      expect(evaluateRule({ field: 'name', operator: 'starts_with', value: 'JOHN' }, { name: 'john doe' })).toBe(true);
      expect(evaluateRule({ field: 'name', operator: 'starts_with', value: 'jane' }, { name: 'john doe' })).toBe(false);
    });

    it('ends_with is case-insensitive', () => {
      expect(evaluateRule({ field: 'email', operator: 'ends_with', value: '.COM' }, { email: 'user@test.com' })).toBe(true);
      expect(evaluateRule({ field: 'email', operator: 'ends_with', value: '.org' }, { email: 'user@test.com' })).toBe(false);
    });
  });

  describe('is_empty / is_not_empty', () => {
    it('is_empty returns true for null, undefined, or empty string', () => {
      expect(evaluateRule({ field: 'a', operator: 'is_empty' }, { a: null })).toBe(true);
      expect(evaluateRule({ field: 'a', operator: 'is_empty' }, { a: undefined })).toBe(true);
      expect(evaluateRule({ field: 'a', operator: 'is_empty' }, { a: '' })).toBe(true);
      expect(evaluateRule({ field: 'a', operator: 'is_empty' }, {})).toBe(true);
    });

    it('is_empty returns false for non-empty values', () => {
      expect(evaluateRule({ field: 'a', operator: 'is_empty' }, { a: 'hello' })).toBe(false);
      expect(evaluateRule({ field: 'a', operator: 'is_empty' }, { a: 0 })).toBe(false);
    });

    it('is_not_empty returns true for non-empty values', () => {
      expect(evaluateRule({ field: 'a', operator: 'is_not_empty' }, { a: 'hello' })).toBe(true);
    });

    it('is_not_empty returns false for empty values', () => {
      expect(evaluateRule({ field: 'a', operator: 'is_not_empty' }, { a: null })).toBe(false);
      expect(evaluateRule({ field: 'a', operator: 'is_not_empty' }, { a: '' })).toBe(false);
    });
  });

  describe('greater_than / less_than', () => {
    it('greater_than compares numerically', () => {
      expect(evaluateRule({ field: 'score', operator: 'greater_than', value: 50 }, { score: 80 })).toBe(true);
      expect(evaluateRule({ field: 'score', operator: 'greater_than', value: 80 }, { score: 50 })).toBe(false);
      expect(evaluateRule({ field: 'score', operator: 'greater_than', value: 50 }, { score: 50 })).toBe(false);
    });

    it('less_than compares numerically', () => {
      expect(evaluateRule({ field: 'score', operator: 'less_than', value: 80 }, { score: 50 })).toBe(true);
      expect(evaluateRule({ field: 'score', operator: 'less_than', value: 50 }, { score: 80 })).toBe(false);
    });
  });

  describe('in / not_in', () => {
    it('in checks membership in an array', () => {
      expect(evaluateRule({ field: 'status', operator: 'in', value: ['A', 'B'] }, { status: 'A' })).toBe(true);
      expect(evaluateRule({ field: 'status', operator: 'in', value: ['A', 'B'] }, { status: 'C' })).toBe(false);
    });

    it('in returns false when value is not an array', () => {
      expect(evaluateRule({ field: 'status', operator: 'in', value: 'A' }, { status: 'A' })).toBe(false);
    });

    it('not_in checks non-membership', () => {
      expect(evaluateRule({ field: 'status', operator: 'not_in', value: ['A', 'B'] }, { status: 'C' })).toBe(true);
      expect(evaluateRule({ field: 'status', operator: 'not_in', value: ['A', 'B'] }, { status: 'A' })).toBe(false);
    });

    it('not_in returns true when value is not an array', () => {
      expect(evaluateRule({ field: 'status', operator: 'not_in', value: 'A' }, { status: 'A' })).toBe(true);
    });
  });

  describe('nested field access', () => {
    it('resolves dot-separated paths', () => {
      expect(evaluateRule(
        { field: 'lead.contact.email', operator: 'equals', value: 'test@test.com' },
        { lead: { contact: { email: 'test@test.com' } } },
      )).toBe(true);
    });

    it('returns undefined for missing nested paths', () => {
      expect(evaluateRule(
        { field: 'lead.missing.path', operator: 'is_empty' },
        { lead: {} },
      )).toBe(true);
    });

    it('handles null in the middle of the path', () => {
      expect(evaluateRule(
        { field: 'lead.contact.email', operator: 'is_empty' },
        { lead: { contact: null } },
      )).toBe(true);
    });
  });

  describe('unknown operator', () => {
    it('returns false for unrecognized operator', () => {
      expect(evaluateRule(
        { field: 'a', operator: 'bogus' as ConditionRule['operator'], value: 'x' },
        { a: 'x' },
      )).toBe(false);
    });
  });
});

describe('evaluateCondition', () => {
  it('AND logic requires all rules to pass', () => {
    const config: ConditionConfig = {
      logic: 'AND',
      rules: [
        { field: 'a', operator: 'equals', value: '1' },
        { field: 'b', operator: 'equals', value: '2' },
      ],
    };
    expect(evaluateCondition(config, { a: '1', b: '2' })).toBe(true);
    expect(evaluateCondition(config, { a: '1', b: '3' })).toBe(false);
  });

  it('OR logic requires at least one rule to pass', () => {
    const config: ConditionConfig = {
      logic: 'OR',
      rules: [
        { field: 'a', operator: 'equals', value: '1' },
        { field: 'b', operator: 'equals', value: '2' },
      ],
    };
    expect(evaluateCondition(config, { a: '1', b: '99' })).toBe(true);
    expect(evaluateCondition(config, { a: '99', b: '2' })).toBe(true);
    expect(evaluateCondition(config, { a: '99', b: '99' })).toBe(false);
  });

  it('returns true for empty rules', () => {
    expect(evaluateCondition({ logic: 'AND', rules: [] }, {})).toBe(true);
    expect(evaluateCondition({ logic: 'OR', rules: [] }, {})).toBe(true);
  });

  it('handles single-rule AND', () => {
    const config: ConditionConfig = {
      logic: 'AND',
      rules: [{ field: 'x', operator: 'equals', value: 'yes' }],
    };
    expect(evaluateCondition(config, { x: 'yes' })).toBe(true);
    expect(evaluateCondition(config, { x: 'no' })).toBe(false);
  });

  it('handles single-rule OR', () => {
    const config: ConditionConfig = {
      logic: 'OR',
      rules: [{ field: 'x', operator: 'equals', value: 'yes' }],
    };
    expect(evaluateCondition(config, { x: 'yes' })).toBe(true);
    expect(evaluateCondition(config, { x: 'no' })).toBe(false);
  });
});

describe('buildLeadConditionContext', () => {
  it('returns null lead when not found', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue(null);

    const ctx = await buildLeadConditionContext('ws1', 'lead1', { foo: 'bar' });
    expect(ctx.lead).toBeNull();
    expect(ctx.foo).toBe('bar');
  });

  it('builds full context from lead data', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 'lead1',
      email: 'test@test.com',
      status: 'QUALIFIED',
      country: 'USA',
      countryCode: 'US',
      industry: 'Tech',
      jobTitle: 'Engineer',
      company: 'Acme',
      tags: [{ tag: { name: 'vip' } }, { tag: { name: 'prospect' } }],
      campaignLeads: [
        { repliedAt: new Date(), status: 'ACTIVE' },
        { repliedAt: null, status: 'BOUNCED' },
      ],
      verification: { status: 'VERIFIED' },
    });
    mockPrisma.suppression.findFirst.mockResolvedValue({ reason: 'UNSUBSCRIBED' });

    const ctx = await buildLeadConditionContext('ws1', 'lead1', {
      replyClassification: 'positive',
      hasReplied: true,
      hasBounced: false,
    });

    expect(ctx.lead).toEqual(expect.objectContaining({
      id: 'lead1',
      email: 'test@test.com',
      status: 'QUALIFIED',
      country: 'USA',
      tags: ['vip', 'prospect'],
      hasReplied: true,
      hasBounced: true,
      isUnsubscribed: true,
      verificationStatus: 'VERIFIED',
      replyClassification: 'positive',
    }));
  });

  it('handles lead without email (no suppression check)', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 'lead2',
      email: null,
      status: 'NEW',
      country: null,
      countryCode: null,
      industry: null,
      jobTitle: null,
      company: null,
      tags: [],
      campaignLeads: [],
      verification: null,
    });

    const ctx = await buildLeadConditionContext('ws1', 'lead2');
    const lead = ctx.lead as Record<string, unknown>;
    expect(lead.email).toBeNull();
    expect(lead.isUnsubscribed).toBe(false);
    expect(lead.verificationStatus).toBe('UNKNOWN');
    expect(mockPrisma.suppression.findFirst).not.toHaveBeenCalled();
  });

  it('handles lead without suppression record', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue({
      id: 'lead3',
      email: 'test@test.com',
      status: 'NEW',
      country: null,
      countryCode: null,
      industry: null,
      jobTitle: null,
      company: null,
      tags: [],
      campaignLeads: [],
      verification: null,
    });
    mockPrisma.suppression.findFirst.mockResolvedValue(null);

    const ctx = await buildLeadConditionContext('ws1', 'lead3');
    const lead = ctx.lead as Record<string, unknown>;
    expect(lead.isUnsubscribed).toBe(false);
  });
});
