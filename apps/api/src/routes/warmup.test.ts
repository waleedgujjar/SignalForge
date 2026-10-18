import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RecipientRow {
  id: string;
  workspaceId: string;
  email: string;
  name: string | null;
  enabled: boolean;
  consentConfirmed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const recipients = new Map<string, RecipientRow>();

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({
    LOG_LEVEL: 'error',
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-with-minimum-length',
    ENCRYPTION_KEY: 'a'.repeat(64),
  }),
}));

vi.mock('@signalforge/database', () => ({
  prisma: {
    warmupRecipient: {
      findMany: vi.fn(async ({ where }: { where: { workspaceId: string } }) =>
        [...recipients.values()]
          .filter((r) => r.workspaceId === where.workspaceId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; workspaceId: string } }) => {
          for (const r of recipients.values()) {
            if (r.id === where.id && r.workspaceId === where.workspaceId) return r;
          }
          return null;
        },
      ),
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { workspaceId_email: { workspaceId: string; email: string } };
        }) => {
          for (const r of recipients.values()) {
            if (
              r.workspaceId === where.workspaceId_email.workspaceId &&
              r.email === where.workspaceId_email.email
            ) {
              return r;
            }
          }
          return null;
        },
      ),
      create: vi.fn(async ({ data }: { data: Omit<RecipientRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
        const row: RecipientRow = {
          id: `r_${recipients.size + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        recipients.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<RecipientRow> }) => {
        const row = recipients.get(where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        recipients.delete(where.id);
        return {};
      }),
      count: vi.fn(async ({ where }: { where: { workspaceId: string } }) =>
        [...recipients.values()].filter((r) => r.workspaceId === where.workspaceId).length,
      ),
    },
  },
}));

beforeEach(() => {
  recipients.clear();
  recipients.set('r_ws1', {
    id: 'r_ws1',
    workspaceId: 'ws_1',
    email: 'friend@example.com',
    name: 'Friend',
    enabled: true,
    consentConfirmed: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  recipients.set('r_ws2', {
    id: 'r_ws2',
    workspaceId: 'ws_2',
    email: 'other@example.com',
    name: 'Other',
    enabled: true,
    consentConfirmed: true,
    createdAt: new Date('2026-01-02'),
    updatedAt: new Date('2026-01-02'),
  });
});

describe('Warmup recipient route logic', () => {
  it('lists only recipients belonging to the caller workspace', async () => {
    const { warmupRecipientService } = await import('@signalforge/warmup');
    const forWs1 = await warmupRecipientService.list('ws_1');
    expect(forWs1).toHaveLength(1);
    expect(forWs1[0]?.workspaceId).toBe('ws_1');
  });

  it('rejects creating a recipient without consentConfirmed', async () => {
    const { warmupRecipientService, RecipientConsentRequiredError } = await import(
      '@signalforge/warmup'
    );
    await expect(
      warmupRecipientService.create({
        workspaceId: 'ws_1',
        email: 'new@example.com',
        consentConfirmed: false,
      }),
    ).rejects.toBeInstanceOf(RecipientConsentRequiredError);
  });

  it('rejects invalid recipient email addresses', async () => {
    const { warmupRecipientService, InvalidRecipientEmailError } = await import(
      '@signalforge/warmup'
    );
    await expect(
      warmupRecipientService.create({
        workspaceId: 'ws_1',
        email: 'notanemail',
        consentConfirmed: true,
      }),
    ).rejects.toBeInstanceOf(InvalidRecipientEmailError);
  });

  it('prevents updating a recipient from a different workspace', async () => {
    const { warmupRecipientService, RecipientNotFoundError } = await import(
      '@signalforge/warmup'
    );
    await expect(
      warmupRecipientService.update('ws_1', 'r_ws2', { enabled: false }),
    ).rejects.toBeInstanceOf(RecipientNotFoundError);
  });

  it('prevents deleting a recipient from a different workspace', async () => {
    const { warmupRecipientService, RecipientNotFoundError } = await import(
      '@signalforge/warmup'
    );
    await expect(
      warmupRecipientService.remove('ws_1', 'r_ws2'),
    ).rejects.toBeInstanceOf(RecipientNotFoundError);
  });
});
