import { beforeEach, describe, expect, it, vi } from 'vitest';

interface LeadRow {
  id: string;
  workspaceId: string;
  email: string;
  companyDomain: string | null;
  updatedAt: Date;
}

const leads = new Map<string, LeadRow>();

vi.mock('@signalforge/database', () => ({
  prisma: {
    lead: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { workspaceId_email: { workspaceId: string; email: string } };
        }) => {
          const { workspaceId, email } = where.workspaceId_email;
          for (const lead of leads.values()) {
            if (lead.workspaceId === workspaceId && lead.email === email) {
              return { id: lead.id };
            }
          }
          return null;
        },
      ),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            workspaceId: string;
            OR: Array<{ companyDomain: string } | { email: { endsWith: string } }>;
          };
        }) => {
          const domainClause = where.OR.find((clause) => 'companyDomain' in clause) as
            | { companyDomain: string }
            | undefined;
          const domain = domainClause?.companyDomain;
          if (!domain) return null;

          const matches = [...leads.values()]
            .filter(
              (lead) =>
                lead.workspaceId === where.workspaceId &&
                (lead.companyDomain === domain || lead.email.endsWith(`@${domain}`)),
            )
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
          return matches[0] ? { id: matches[0].id } : null;
        },
      ),
    },
  },
}));

beforeEach(() => {
  leads.clear();
  leads.set('lead_1', {
    id: 'lead_1',
    workspaceId: 'ws_1',
    email: 'alice@acme.com',
    companyDomain: 'acme.com',
    updatedAt: new Date('2026-01-01'),
  });
});

describe('matchLeadByEmail', () => {
  it('matches lead by normalized email address', async () => {
    const { matchLeadByEmail } = await import('./lead-matcher.js');
    const result = await matchLeadByEmail({
      workspaceId: 'ws_1',
      fromEmail: '  Alice@Acme.com ',
    });
    expect(result.matched).toBe(true);
    expect(result.leadId).toBe('lead_1');
  });

  it('returns unmatched when email is unknown in workspace', async () => {
    const { matchLeadByEmail } = await import('./lead-matcher.js');
    const result = await matchLeadByEmail({
      workspaceId: 'ws_1',
      fromEmail: 'unknown@example.com',
    });
    expect(result.matched).toBe(false);
    expect(result.leadId).toBeNull();
  });

  it('does not match leads from a different workspace', async () => {
    const { matchLeadByEmail } = await import('./lead-matcher.js');
    const result = await matchLeadByEmail({
      workspaceId: 'ws_other',
      fromEmail: 'alice@acme.com',
    });
    expect(result.matched).toBe(false);
  });
});

describe('matchLeadByDomain', () => {
  it('matches lead by company domain', async () => {
    const { matchLeadByDomain } = await import('./lead-matcher.js');
    const result = await matchLeadByDomain('ws_1', 'bob@acme.com');
    expect(result.matched).toBe(true);
    expect(result.leadId).toBe('lead_1');
  });

  it('returns unmatched for invalid email without domain', async () => {
    const { matchLeadByDomain } = await import('./lead-matcher.js');
    const result = await matchLeadByDomain('ws_1', 'not-an-email');
    expect(result.matched).toBe(false);
    expect(result.leadId).toBeNull();
  });
});
