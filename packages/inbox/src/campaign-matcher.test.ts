import { beforeEach, describe, expect, it, vi } from 'vitest';

interface EmailMessageRow {
  id: string;
  workspaceId: string;
  mailboxId: string;
  internetMessageId: string;
  campaignId: string | null;
  campaignLeadId: string | null;
  leadId: string | null;
  createdAt: Date;
}

interface ConversationMessageRow {
  workspaceId: string;
  internetMessageId: string;
  emailMessageId: string | null;
  conversation: { campaignId: string | null; campaignLeadId: string | null };
  emailMessage: { id: string; campaignId: string | null; campaignLeadId: string | null } | null;
}

interface CampaignLeadRow {
  id: string;
  leadId: string;
  campaignId: string;
  status: string;
  enrolledAt: Date;
  campaign: {
    workspaceId: string;
    status: string;
    mailboxId: string | null;
    mailboxes: Array<{ mailboxId: string }>;
  };
}

const emailMessages: EmailMessageRow[] = [];
const conversationMessages: ConversationMessageRow[] = [];
const campaignLeads: CampaignLeadRow[] = [];

vi.mock('@signalforge/database', () => ({
  prisma: {
    emailMessage: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { workspaceId: string; internetMessageId: { in: string[] } };
        }) => {
          return (
            emailMessages
              .filter(
                (row) =>
                  row.workspaceId === where.workspaceId &&
                  where.internetMessageId.in.includes(row.internetMessageId),
              )
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
          );
        },
      ),
    },
    conversationMessage: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { workspaceId: string; internetMessageId: { in: string[] } };
        }) => {
          return (
            conversationMessages.find(
              (row) =>
                row.workspaceId === where.workspaceId &&
                where.internetMessageId.in.includes(row.internetMessageId),
            ) ?? null
          );
        },
      ),
    },
    campaignLead: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            leadId: string;
            status: { in: string[] };
            campaign: {
              workspaceId: string;
              status: { in: string[] };
              OR: Array<{ mailboxId: string } | { mailboxes: { some: { mailboxId: string } } }>;
            };
          };
        }) => {
          const mailboxIds = where.campaign.OR.flatMap((clause) =>
            'mailboxId' in clause
              ? [clause.mailboxId]
              : clause.mailboxes.some.mailboxId
                ? [clause.mailboxes.some.mailboxId]
                : [],
          );

          const match = campaignLeads
            .filter(
              (row) =>
                row.leadId === where.leadId &&
                where.status.in.includes(row.status) &&
                row.campaign.workspaceId === where.campaign.workspaceId &&
                where.campaign.status.in.includes(row.campaign.status) &&
                (mailboxIds.includes(row.campaign.mailboxId ?? '') ||
                  row.campaign.mailboxes.some((m) => mailboxIds.includes(m.mailboxId))),
            )
            .sort((a, b) => b.enrolledAt.getTime() - a.enrolledAt.getTime())[0];

          return match ? { id: match.id, campaignId: match.campaignId } : null;
        },
      ),
    },
  },
}));

beforeEach(() => {
  emailMessages.length = 0;
  conversationMessages.length = 0;
  campaignLeads.length = 0;
});

describe('matchCampaignContext', () => {
  it('matches campaign via outbound email message-id chain', async () => {
    emailMessages.push({
      id: 'em_1',
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      internetMessageId: '<campaign-msg@example.com>',
      campaignId: 'camp_1',
      campaignLeadId: 'cl_1',
      leadId: 'lead_1',
      createdAt: new Date('2026-01-01'),
    });

    const { matchCampaignContext } = await import('./campaign-matcher.js');
    const result = await matchCampaignContext({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      inReplyTo: '<campaign-msg@example.com>',
    });

    expect(result.matchStatus).toBe('MATCHED');
    expect(result.campaignId).toBe('camp_1');
    expect(result.campaignLeadId).toBe('cl_1');
    expect(result.emailMessageId).toBe('em_1');
  });

  it('returns PARTIAL when outbound campaign mailbox differs', async () => {
    emailMessages.push({
      id: 'em_2',
      workspaceId: 'ws_1',
      mailboxId: 'mb_other',
      internetMessageId: '<other-mailbox@example.com>',
      campaignId: 'camp_2',
      campaignLeadId: 'cl_2',
      leadId: 'lead_2',
      createdAt: new Date('2026-01-02'),
    });

    const { matchCampaignContext } = await import('./campaign-matcher.js');
    const result = await matchCampaignContext({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      inReplyTo: '<other-mailbox@example.com>',
    });

    expect(result.matchStatus).toBe('PARTIAL');
    expect(result.campaignId).toBe('camp_2');
  });

  it('matches campaign from prior inbound conversation message', async () => {
    conversationMessages.push({
      workspaceId: 'ws_1',
      internetMessageId: '<prior-inbound@example.com>',
      emailMessageId: 'em_prior',
      conversation: { campaignId: 'camp_3', campaignLeadId: 'cl_3' },
      emailMessage: { id: 'em_prior', campaignId: 'camp_3', campaignLeadId: 'cl_3' },
    });

    const { matchCampaignContext } = await import('./campaign-matcher.js');
    const result = await matchCampaignContext({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      references: ['<prior-inbound@example.com>'],
    });

    expect(result.matchStatus).toBe('MATCHED');
    expect(result.campaignId).toBe('camp_3');
    expect(result.emailMessageId).toBe('em_prior');
  });

  it('falls back to active campaign enrollment by lead id', async () => {
    campaignLeads.push({
      id: 'cl_enrolled',
      leadId: 'lead_9',
      campaignId: 'camp_enrolled',
      status: 'ACTIVE',
      enrolledAt: new Date('2026-01-03'),
      campaign: {
        workspaceId: 'ws_1',
        status: 'ACTIVE',
        mailboxId: 'mb_1',
        mailboxes: [],
      },
    });

    const { matchCampaignContext } = await import('./campaign-matcher.js');
    const result = await matchCampaignContext({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      leadId: 'lead_9',
    });

    expect(result.matchStatus).toBe('PARTIAL');
    expect(result.campaignId).toBe('camp_enrolled');
    expect(result.campaignLeadId).toBe('cl_enrolled');
    expect(result.emailMessageId).toBeNull();
  });

  it('returns UNMATCHED when no campaign context is found', async () => {
    const { matchCampaignContext } = await import('./campaign-matcher.js');
    const result = await matchCampaignContext({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      leadId: 'lead_missing',
    });

    expect(result.matchStatus).toBe('UNMATCHED');
    expect(result.campaignId).toBeNull();
    expect(result.campaignLeadId).toBeNull();
    expect(result.emailMessageId).toBeNull();
  });
});
