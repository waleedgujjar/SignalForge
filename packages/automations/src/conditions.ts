import { prisma } from '@signalforge/database';
import type { ConditionConfig, ConditionOperator, ConditionRule } from './types.js';

function getFieldValue(field: string, context: Record<string, unknown>): unknown {
  const parts = field.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function compareValues(operator: ConditionOperator, left: unknown, right: unknown): boolean {
  const leftStr = left === null || left === undefined ? '' : String(left);
  const rightStr = right === null || right === undefined ? '' : String(right);

  switch (operator) {
    case 'equals':
      return leftStr === rightStr;
    case 'not_equals':
      return leftStr !== rightStr;
    case 'contains':
      return leftStr.toLowerCase().includes(rightStr.toLowerCase());
    case 'not_contains':
      return !leftStr.toLowerCase().includes(rightStr.toLowerCase());
    case 'starts_with':
      return leftStr.toLowerCase().startsWith(rightStr.toLowerCase());
    case 'ends_with':
      return leftStr.toLowerCase().endsWith(rightStr.toLowerCase());
    case 'is_empty':
      return left === null || left === undefined || leftStr === '';
    case 'is_not_empty':
      return left !== null && left !== undefined && leftStr !== '';
    case 'greater_than':
      return Number(left) > Number(right);
    case 'less_than':
      return Number(left) < Number(right);
    case 'in':
      return Array.isArray(right) ? right.map(String).includes(leftStr) : false;
    case 'not_in':
      return Array.isArray(right) ? !right.map(String).includes(leftStr) : true;
    default:
      return false;
  }
}

export function evaluateRule(rule: ConditionRule, context: Record<string, unknown>): boolean {
  const value = getFieldValue(rule.field, context);
  return compareValues(rule.operator, value, rule.value);
}

export function evaluateCondition(config: ConditionConfig, context: Record<string, unknown>): boolean {
  if (config.rules.length === 0) return true;
  if (config.logic === 'OR') {
    return config.rules.some((rule) => evaluateRule(rule, context));
  }
  return config.rules.every((rule) => evaluateRule(rule, context));
}

export async function buildLeadConditionContext(
  workspaceId: string,
  leadId: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId },
    include: {
      verification: true,
      tags: { include: { tag: true } },
      campaignLeads: true,
    },
  });
  if (!lead) {
    return { lead: null, ...extra };
  }

  const suppression = lead.email
    ? await prisma.suppression.findFirst({
        where: { workspaceId, type: 'EMAIL', value: lead.email.toLowerCase() },
      })
    : null;

  return {
    lead: {
      id: lead.id,
      email: lead.email,
      status: lead.status,
      country: lead.country,
      countryCode: lead.countryCode,
      industry: lead.industry,
      jobTitle: lead.jobTitle,
      company: lead.company,
      tags: lead.tags.map((t) => t.tag.name),
      hasReplied: lead.campaignLeads.some((cl) => cl.repliedAt !== null),
      hasBounced: lead.campaignLeads.some((cl) => cl.status === 'BOUNCED'),
      isUnsubscribed: suppression?.reason === 'UNSUBSCRIBED',
      verificationStatus: lead.verification?.status ?? 'UNKNOWN',
      replyClassification: extra.replyClassification,
      hasRepliedFlag: extra.hasReplied,
      hasBouncedFlag: extra.hasBounced,
    },
    ...extra,
  };
}
