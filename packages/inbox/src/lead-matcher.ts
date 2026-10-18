import { prisma } from '@signalforge/database';
import type { LeadMatchResult } from './types.js';

export interface MatchLeadInput {
  workspaceId: string;
  fromEmail: string;
}

export async function matchLeadByEmail(input: MatchLeadInput): Promise<LeadMatchResult> {
  const normalized = input.fromEmail.trim().toLowerCase();
  const lead = await prisma.lead.findUnique({
    where: {
      workspaceId_email: {
        workspaceId: input.workspaceId,
        email: normalized,
      },
    },
    select: { id: true },
  });

  if (!lead) {
    return { leadId: null, matched: false };
  }

  return { leadId: lead.id, matched: true };
}

export async function matchLeadByDomain(
  workspaceId: string,
  fromEmail: string,
): Promise<LeadMatchResult> {
  const domain = fromEmail.split('@')[1]?.toLowerCase();
  if (!domain) return { leadId: null, matched: false };

  const lead = await prisma.lead.findFirst({
    where: {
      workspaceId,
      OR: [{ companyDomain: domain }, { email: { endsWith: `@${domain}` } }],
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });

  if (!lead) return { leadId: null, matched: false };
  return { leadId: lead.id, matched: true };
}
