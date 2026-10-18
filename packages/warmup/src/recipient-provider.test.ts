import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Recipient {
  id: string;
  email: string;
  name: string | null;
  enabled: boolean;
  consentConfirmed: boolean;
  workspaceId: string;
  createdAt: Date;
}

interface Config {
  mailboxId: string;
  lastRecipientId: string | null;
}

const recipients: Recipient[] = [];
const configs = new Map<string, Config>();

vi.mock('@signalforge/database', () => ({
  prisma: {
    warmupRecipient: {
      findMany: async ({
        where,
        orderBy: _orderBy,
      }: {
        where: {
          workspaceId: string;
          enabled: boolean;
          consentConfirmed: boolean;
          email?: { not: string };
        };
        orderBy: unknown;
      }) => {
        return recipients
          .filter(
            (r) =>
              r.workspaceId === where.workspaceId &&
              r.enabled === where.enabled &&
              r.consentConfirmed === where.consentConfirmed &&
              (!where.email?.not || r.email !== where.email.not),
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((r) => ({ id: r.id, email: r.email, name: r.name }));
      },
    },
    emailWarmupConfig: {
      findUnique: async ({ where }: { where: { mailboxId: string } }) => {
        return configs.get(where.mailboxId) ?? null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { mailboxId: string };
        data: { lastRecipientId: string };
      }) => {
        const existing = configs.get(where.mailboxId);
        if (!existing) throw new Error('not found');
        existing.lastRecipientId = data.lastRecipientId;
        return existing;
      },
    },
  },
}));

beforeEach(() => {
  recipients.length = 0;
  configs.clear();
});

describe('UserConfiguredRecipientProvider', () => {
  it('returns null when no enabled+consented recipients exist', async () => {
    const { UserConfiguredRecipientProvider } = await import('./recipient-provider.js');
    configs.set('mb_1', { mailboxId: 'mb_1', lastRecipientId: null });
    recipients.push({
      id: 'r_1',
      email: 'a@example.com',
      name: null,
      enabled: false,
      consentConfirmed: true,
      workspaceId: 'ws_1',
      createdAt: new Date('2026-01-01'),
    });
    const provider = new UserConfiguredRecipientProvider();
    const selected = await provider.select({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      excludeEmail: 'sender@example.com',
    });
    expect(selected).toBeNull();
  });

  it('rotates recipients in a round-robin using lastRecipientId', async () => {
    const { UserConfiguredRecipientProvider } = await import('./recipient-provider.js');
    configs.set('mb_1', { mailboxId: 'mb_1', lastRecipientId: null });
    recipients.push(
      {
        id: 'r_1',
        email: 'a@example.com',
        name: 'A',
        enabled: true,
        consentConfirmed: true,
        workspaceId: 'ws_1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'r_2',
        email: 'b@example.com',
        name: 'B',
        enabled: true,
        consentConfirmed: true,
        workspaceId: 'ws_1',
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      {
        id: 'r_3',
        email: 'c@example.com',
        name: 'C',
        enabled: true,
        consentConfirmed: true,
        workspaceId: 'ws_1',
        createdAt: new Date('2026-01-03T00:00:00Z'),
      },
    );
    const provider = new UserConfiguredRecipientProvider();
    const first = await provider.select({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      excludeEmail: 'x@example.com',
    });
    expect(first?.id).toBe('r_1');
    const second = await provider.select({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      excludeEmail: 'x@example.com',
    });
    expect(second?.id).toBe('r_2');
    const third = await provider.select({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      excludeEmail: 'x@example.com',
    });
    expect(third?.id).toBe('r_3');
    const wrap = await provider.select({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      excludeEmail: 'x@example.com',
    });
    expect(wrap?.id).toBe('r_1');
  });

  it('excludes the sender email so warmup never emails itself', async () => {
    const { UserConfiguredRecipientProvider } = await import('./recipient-provider.js');
    configs.set('mb_1', { mailboxId: 'mb_1', lastRecipientId: null });
    recipients.push(
      {
        id: 'r_1',
        email: 'sender@example.com',
        name: null,
        enabled: true,
        consentConfirmed: true,
        workspaceId: 'ws_1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'r_2',
        email: 'other@example.com',
        name: null,
        enabled: true,
        consentConfirmed: true,
        workspaceId: 'ws_1',
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    );
    const provider = new UserConfiguredRecipientProvider();
    const selected = await provider.select({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      excludeEmail: 'sender@example.com',
    });
    expect(selected?.email).toBe('other@example.com');
  });

  it('returns null when only the sender is a recipient', async () => {
    const { UserConfiguredRecipientProvider } = await import('./recipient-provider.js');
    configs.set('mb_1', { mailboxId: 'mb_1', lastRecipientId: null });
    recipients.push({
      id: 'r_1',
      email: 'sender@example.com',
      name: null,
      enabled: true,
      consentConfirmed: true,
      workspaceId: 'ws_1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const provider = new UserConfiguredRecipientProvider();
    const selected = await provider.select({
      workspaceId: 'ws_1',
      mailboxId: 'mb_1',
      excludeEmail: 'sender@example.com',
    });
    expect(selected).toBeNull();
  });
});
