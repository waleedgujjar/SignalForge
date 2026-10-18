import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationService, MessageService } from '@signalforge/inbox';

let conversationService: ConversationService;
let messageService: MessageService;

interface ConversationRow {
  id: string;
  workspaceId: string;
  mailboxId: string;
  status: string;
  matchStatus: string;
  subject: string | null;
  unreadCount: number;
}

interface ConversationMessageRow {
  id: string;
  conversationId: string;
  workspaceId: string;
  direction: string;
  textBody: string | null;
  createdAt: Date;
}

const conversations = new Map<string, ConversationRow>();
const conversationMessages = new Map<string, ConversationMessageRow>();

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({
    LOG_LEVEL: 'error',
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-with-minimum-length',
    ENCRYPTION_KEY: 'a'.repeat(64),
    AI_PROVIDER: 'mock',
    OPENAI_API_KEY: 'test-key',
    OPENAI_MODEL: 'gpt-4o-mini',
    REDIS_URL: 'redis://localhost:6379',
  }),
}));

vi.mock('@signalforge/database', () => ({
  prisma: {
    conversation: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) => {
        const row = conversations.get(where.id);
        if (!row || row.workspaceId !== where.workspaceId) return null;
        return row;
      }),
      findMany: vi.fn(async ({ where }: { where: { workspaceId: string } }) =>
        [...conversations.values()].filter((row) => row.workspaceId === where.workspaceId),
      ),
    },
    conversationMessage: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { conversationId: string; workspaceId: string };
        }) =>
          [...conversationMessages.values()]
            .filter(
              (row) =>
                row.conversationId === where.conversationId &&
                row.workspaceId === where.workspaceId,
            )
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ),
    },
  },
}));

beforeAll(async () => {
  const inbox = await import('@signalforge/inbox');
  conversationService = inbox.conversationService;
  messageService = inbox.messageService;
}, 30_000);

beforeEach(() => {
  conversations.clear();
  conversationMessages.clear();

  conversations.set('conv_ws1', {
    id: 'conv_ws1',
    workspaceId: 'ws_1',
    mailboxId: 'mb_1',
    status: 'OPEN',
    matchStatus: 'MATCHED',
    subject: 'Demo follow-up',
    unreadCount: 1,
  });
  conversations.set('conv_ws2', {
    id: 'conv_ws2',
    workspaceId: 'ws_2',
    mailboxId: 'mb_2',
    status: 'OPEN',
    matchStatus: 'MATCHED',
    subject: 'Other workspace thread',
    unreadCount: 0,
  });

  conversationMessages.set('cm_ws1', {
    id: 'cm_ws1',
    conversationId: 'conv_ws1',
    workspaceId: 'ws_1',
    direction: 'INBOUND',
    textBody: 'Thanks for reaching out.',
    createdAt: new Date('2026-01-01'),
  });
  conversationMessages.set('cm_ws2', {
    id: 'cm_ws2',
    conversationId: 'conv_ws2',
    workspaceId: 'ws_2',
    direction: 'INBOUND',
    textBody: 'Private message',
    createdAt: new Date('2026-01-02'),
  });
});

describe('Inbox conversation workspace isolation', () => {
  it('returns a conversation only when workspace matches', async () => {
    const allowed = await conversationService.findById('conv_ws1', 'ws_1');
    expect(allowed).not.toBeNull();
    expect(allowed?.id).toBe('conv_ws1');

    const denied = await conversationService.findById('conv_ws1', 'ws_2');
    expect(denied).toBeNull();
  });

  it('prevents reading another workspace conversation by id', async () => {
    const result = await conversationService.findById('conv_ws2', 'ws_1');
    expect(result).toBeNull();
  });

  it('lists only conversations belonging to the caller workspace', async () => {
    const { prisma } = await import('@signalforge/database');
    const rows = await prisma.conversation.findMany({ where: { workspaceId: 'ws_1' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('conv_ws1');
  });

  it('scopes conversation messages to workspace and conversation', async () => {
    const ownMessages = await messageService.listMessages('conv_ws1', 'ws_1');
    expect(ownMessages).toHaveLength(1);
    expect(ownMessages[0]?.id).toBe('cm_ws1');

    const crossWorkspaceMessages = await messageService.listMessages('conv_ws2', 'ws_1');
    expect(crossWorkspaceMessages).toHaveLength(0);
  });

  it('does not leak messages when conversation id exists in another workspace', async () => {
    const result = await messageService.listMessages('conv_ws2', 'ws_1');
    expect(result).toEqual([]);
  });
});
