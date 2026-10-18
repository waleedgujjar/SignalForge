import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  id: string;
  workspaceId: string;
  email: string;
  name: string | null;
  enabled: boolean;
  consentConfirmed: boolean;
  createdAt: Date;
}

const rows = new Map<string, Row>();

vi.mock('@signalforge/database', () => ({
  prisma: {
    warmupRecipient: {
      findMany: async ({ where }: { where: { workspaceId: string } }) =>
        [...rows.values()].filter((r) => r.workspaceId === where.workspaceId),
      findFirst: async ({
        where,
      }: {
        where: { id: string; workspaceId: string };
      }) => {
        for (const r of rows.values()) {
          if (r.id === where.id && r.workspaceId === where.workspaceId) return r;
        }
        return null;
      },
      findUnique: async ({
        where,
      }: {
        where: { workspaceId_email: { workspaceId: string; email: string } };
      }) => {
        for (const r of rows.values()) {
          if (
            r.workspaceId === where.workspaceId_email.workspaceId &&
            r.email === where.workspaceId_email.email
          ) {
            return r;
          }
        }
        return null;
      },
      create: async ({ data }: { data: Omit<Row, 'id' | 'createdAt'> }) => {
        const row: Row = {
          id: `r_${rows.size + 1}`,
          createdAt: new Date(),
          ...data,
        };
        rows.set(row.id, row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Row>;
      }) => {
        const row = rows.get(where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        rows.delete(where.id);
        return {};
      },
      count: async ({
        where,
      }: {
        where: { workspaceId: string; enabled: boolean; consentConfirmed: boolean };
      }) =>
        [...rows.values()].filter(
          (r) =>
            r.workspaceId === where.workspaceId &&
            r.enabled === where.enabled &&
            r.consentConfirmed === where.consentConfirmed,
        ).length,
    },
  },
}));

beforeEach(() => {
  rows.clear();
});

describe('WarmupRecipientService', () => {
  it('rejects creation without consentConfirmed', async () => {
    const { warmupRecipientService, RecipientConsentRequiredError } = await import(
      './recipient-service.js'
    );
    await expect(
      warmupRecipientService.create({
        workspaceId: 'ws_1',
        email: 'friend@example.com',
        consentConfirmed: false,
      }),
    ).rejects.toBeInstanceOf(RecipientConsentRequiredError);
  });

  it('rejects invalid email addresses', async () => {
    const { warmupRecipientService, InvalidRecipientEmailError } = await import(
      './recipient-service.js'
    );
    await expect(
      warmupRecipientService.create({
        workspaceId: 'ws_1',
        email: 'not-an-email',
        consentConfirmed: true,
      }),
    ).rejects.toBeInstanceOf(InvalidRecipientEmailError);
  });

  it('rejects duplicate emails per workspace', async () => {
    const { warmupRecipientService, RecipientAlreadyExistsError } = await import(
      './recipient-service.js'
    );
    await warmupRecipientService.create({
      workspaceId: 'ws_1',
      email: 'friend@example.com',
      consentConfirmed: true,
    });
    await expect(
      warmupRecipientService.create({
        workspaceId: 'ws_1',
        email: 'Friend@example.com',
        consentConfirmed: true,
      }),
    ).rejects.toBeInstanceOf(RecipientAlreadyExistsError);
  });

  it('prevents cross-workspace update or removal', async () => {
    const { warmupRecipientService, RecipientNotFoundError } = await import(
      './recipient-service.js'
    );
    const created = await warmupRecipientService.create({
      workspaceId: 'ws_1',
      email: 'friend@example.com',
      consentConfirmed: true,
    });
    await expect(
      warmupRecipientService.update('ws_other', created.id, { enabled: false }),
    ).rejects.toBeInstanceOf(RecipientNotFoundError);
    await expect(
      warmupRecipientService.remove('ws_other', created.id),
    ).rejects.toBeInstanceOf(RecipientNotFoundError);
  });

  it('lists only recipients for the caller workspace', async () => {
    const { warmupRecipientService } = await import('./recipient-service.js');
    await warmupRecipientService.create({
      workspaceId: 'ws_1',
      email: 'ws1@example.com',
      consentConfirmed: true,
    });
    await warmupRecipientService.create({
      workspaceId: 'ws_2',
      email: 'ws2@example.com',
      consentConfirmed: true,
    });
    const forWs1 = await warmupRecipientService.list('ws_1');
    expect(forWs1).toHaveLength(1);
    expect(forWs1[0]?.email).toBe('ws1@example.com');
  });
});
