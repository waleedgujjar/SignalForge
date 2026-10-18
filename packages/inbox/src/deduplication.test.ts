import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MessageRow {
  id: string;
  conversationId: string;
  workspaceId: string;
  providerMessageId: string | null;
  internetMessageId: string | null;
}

const messages = new Map<string, MessageRow>();

vi.mock('@signalforge/database', () => ({
  prisma: {
    conversationMessage: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            workspaceId_providerMessageId: { workspaceId: string; providerMessageId: string };
          };
        }) => {
          const { workspaceId, providerMessageId } = where.workspaceId_providerMessageId;
          for (const row of messages.values()) {
            if (row.workspaceId === workspaceId && row.providerMessageId === providerMessageId) {
              return { id: row.id, conversationId: row.conversationId };
            }
          }
          return null;
        },
      ),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { workspaceId: string; internetMessageId: string };
        }) => {
          for (const row of messages.values()) {
            if (
              row.workspaceId === where.workspaceId &&
              row.internetMessageId === where.internetMessageId
            ) {
              return { id: row.id, conversationId: row.conversationId };
            }
          }
          return null;
        },
      ),
    },
  },
}));

beforeEach(() => {
  messages.clear();
  messages.set('msg_1', {
    id: 'msg_1',
    conversationId: 'conv_1',
    workspaceId: 'ws_1',
    providerMessageId: 'prov_abc',
    internetMessageId: '<internet-abc@mail.example>',
  });
});

describe('checkMessageDuplicate', () => {
  it('detects duplicate by provider message id within workspace', async () => {
    const { checkMessageDuplicate } = await import('./deduplication.js');
    const result = await checkMessageDuplicate({
      workspaceId: 'ws_1',
      providerMessageId: 'prov_abc',
    });
    expect(result.duplicate).toBe(true);
    expect(result.existingMessageId).toBe('msg_1');
    expect(result.existingConversationId).toBe('conv_1');
  });

  it('detects duplicate by internet message id when provider id is absent', async () => {
    const { checkMessageDuplicate } = await import('./deduplication.js');
    const result = await checkMessageDuplicate({
      workspaceId: 'ws_1',
      internetMessageId: '<internet-abc@mail.example>',
    });
    expect(result.duplicate).toBe(true);
    expect(result.existingMessageId).toBe('msg_1');
  });

  it('returns not duplicate when no ids match', async () => {
    const { checkMessageDuplicate } = await import('./deduplication.js');
    const result = await checkMessageDuplicate({
      workspaceId: 'ws_1',
      providerMessageId: 'prov_unknown',
      internetMessageId: '<unknown@mail.example>',
    });
    expect(result.duplicate).toBe(false);
    expect(result.existingMessageId).toBeUndefined();
  });

  it('scopes duplicate detection to the requesting workspace', async () => {
    const { checkMessageDuplicate } = await import('./deduplication.js');
    const result = await checkMessageDuplicate({
      workspaceId: 'ws_other',
      providerMessageId: 'prov_abc',
    });
    expect(result.duplicate).toBe(false);
  });

  it('prefers provider message id lookup before internet message id', async () => {
    messages.set('msg_2', {
      id: 'msg_2',
      conversationId: 'conv_2',
      workspaceId: 'ws_1',
      providerMessageId: 'prov_xyz',
      internetMessageId: '<shared@mail.example>',
    });
    messages.set('msg_3', {
      id: 'msg_3',
      conversationId: 'conv_3',
      workspaceId: 'ws_1',
      providerMessageId: null,
      internetMessageId: '<shared@mail.example>',
    });

    const { checkMessageDuplicate } = await import('./deduplication.js');
    const result = await checkMessageDuplicate({
      workspaceId: 'ws_1',
      providerMessageId: 'prov_xyz',
      internetMessageId: '<shared@mail.example>',
    });
    expect(result.existingMessageId).toBe('msg_2');
  });
});
