import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ConversationMessageRow {
  conversationId: string;
  workspaceId: string;
  internetMessageId: string | null;
  providerMessageId: string | null;
  inReplyTo: string | null;
  createdAt: Date;
}

interface EmailMessageRow {
  id: string;
  workspaceId: string;
  mailboxId: string;
  internetMessageId: string | null;
  campaignId: string | null;
  leadId: string | null;
}

interface ConversationRow {
  id: string;
  workspaceId: string;
  mailboxId: string;
  subject: string | null;
  leadId: string | null;
  campaignId: string | null;
  lastMessageAt: Date;
}

const conversationMessages: ConversationMessageRow[] = [];
const emailMessages: EmailMessageRow[] = [];
const conversations: ConversationRow[] = [];

vi.mock('@signalforge/database', () => ({
  prisma: {
    conversationMessage: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            workspaceId: string;
            OR: Array<
              | { internetMessageId: { in: string[] } }
              | { providerMessageId: { in: string[] } }
            >;
          };
        }) => {
          const ids =
            where.OR.flatMap((clause) =>
              'internetMessageId' in clause ? clause.internetMessageId.in : clause.providerMessageId.in,
            ) ?? [];
          const match = conversationMessages
            .filter(
              (row) =>
                row.workspaceId === where.workspaceId &&
                ((row.internetMessageId && ids.includes(row.internetMessageId)) ||
                  (row.providerMessageId && ids.includes(row.providerMessageId))),
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
          return match
            ? { conversationId: match.conversationId, inReplyTo: match.inReplyTo }
            : null;
        },
      ),
    },
    emailMessage: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { workspaceId: string; internetMessageId: { in: string[] } };
        }) => {
          return (
            emailMessages.find(
              (row) =>
                row.workspaceId === where.workspaceId &&
                row.internetMessageId &&
                where.internetMessageId.in.includes(row.internetMessageId),
            ) ?? null
          );
        },
      ),
    },
    conversation: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            workspaceId: string;
            mailboxId: string;
            leadId?: string;
            campaignId?: string;
          };
        }) => {
          return (
            conversations.find(
              (row) =>
                row.workspaceId === where.workspaceId &&
                row.mailboxId === where.mailboxId &&
                (where.leadId === undefined || row.leadId === where.leadId) &&
                (where.campaignId === undefined || row.campaignId === where.campaignId),
            ) ?? null
          );
        },
      ),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { workspaceId: string; mailboxId: string; subject: { not: null } };
        }) => {
          return conversations
            .filter(
              (row) =>
                row.workspaceId === where.workspaceId &&
                row.mailboxId === where.mailboxId &&
                row.subject !== null,
            )
            .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
            .slice(0, 25)
            .map((row) => ({ id: row.id, subject: row.subject }));
        },
      ),
    },
  },
}));

beforeEach(() => {
  conversationMessages.length = 0;
  emailMessages.length = 0;
  conversations.length = 0;
});

describe('resolveConversationThread', () => {
  it('matches an existing conversation via In-Reply-To internet message id', async () => {
    conversationMessages.push({
      conversationId: 'conv_reply',
      workspaceId: 'ws_1',
      internetMessageId: '<parent@example.com>',
      providerMessageId: null,
      inReplyTo: null,
      createdAt: new Date('2026-01-01'),
    });

    const { resolveConversationThread } = await import('./thread-resolver.js');
    const result = await resolveConversationThread({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      fromEmail: 'lead@example.com',
      inReplyTo: '<parent@example.com>',
    });

    expect(result.conversationId).toBe('conv_reply');
    expect(result.matchedBy).toBe('IN_REPLY_TO');
  });

  it('matches via References when In-Reply-To does not match', async () => {
    conversationMessages.push({
      conversationId: 'conv_ref',
      workspaceId: 'ws_1',
      internetMessageId: '<older@example.com>',
      providerMessageId: null,
      inReplyTo: null,
      createdAt: new Date('2026-01-01'),
    });

    const { resolveConversationThread } = await import('./thread-resolver.js');
    const result = await resolveConversationThread({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      fromEmail: 'lead@example.com',
      references: ['<older@example.com>'],
    });

    expect(result.conversationId).toBe('conv_ref');
    expect(result.matchedBy).toBe('REFERENCES');
  });

  it('creates thread link from outbound email message when mailbox matches', async () => {
    emailMessages.push({
      id: 'em_1',
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      internetMessageId: '<sent@example.com>',
      campaignId: 'camp_1',
      leadId: 'lead_1',
    });
    conversations.push({
      id: 'conv_outbound',
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      subject: 'Hello',
      leadId: 'lead_1',
      campaignId: 'camp_1',
      lastMessageAt: new Date('2026-01-02'),
    });

    const { resolveConversationThread } = await import('./thread-resolver.js');
    const result = await resolveConversationThread({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      fromEmail: 'lead@example.com',
      inReplyTo: '<sent@example.com>',
    });

    expect(result.conversationId).toBe('conv_outbound');
    expect(result.matchedBy).toBe('IN_REPLY_TO');
  });

  it('falls back to normalized subject matching', async () => {
    conversations.push({
      id: 'conv_subject',
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      subject: 'Pricing question',
      leadId: null,
      campaignId: null,
      lastMessageAt: new Date('2026-01-03'),
    });

    const { resolveConversationThread } = await import('./thread-resolver.js');
    const result = await resolveConversationThread({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      fromEmail: 'lead@example.com',
      subject: 'Re: Pricing question',
    });

    expect(result.conversationId).toBe('conv_subject');
    expect(result.matchedBy).toBe('SUBJECT');
  });

  it('returns NONE when no thread can be resolved', async () => {
    const { resolveConversationThread } = await import('./thread-resolver.js');
    const result = await resolveConversationThread({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      fromEmail: 'lead@example.com',
      subject: 'Brand new thread',
    });

    expect(result.conversationId).toBeNull();
    expect(result.matchedBy).toBe('NONE');
  });
});
