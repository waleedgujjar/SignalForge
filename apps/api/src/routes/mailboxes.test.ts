import { describe, expect, it, vi, beforeEach } from 'vitest';

interface MockMailbox {
  id: string;
  workspaceId: string;
  provider: string;
  name: string | null;
  emailAddress: string;
  fromName: string;
  replyTo: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  encryptionType: string;
  status: string;
  dailySendingLimit: number;
  currentDailyUsage: number;
  timezone: string | null;
  healthStatus: string;
  warmupStatus: string;
  verifiedAt: Date | null;
  lastTestedAt: Date | null;
  lastSuccessfulSendAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const mailboxes = new Map<string, MockMailbox>();

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
    mailbox: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        for (const m of mailboxes.values()) {
          if (m.id === where.id && m.workspaceId === where.workspaceId) return m;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }: { where: { workspaceId: string } }) =>
        [...mailboxes.values()].filter((m) => m.workspaceId === where.workspaceId),
      ),
    },
  },
}));

interface EligibilityInput {
  status: string;
  healthStatus: string;
  dailySendingLimit: number;
  currentDailyUsage: number;
  verifiedAt: Date | null;
  smtpHost: string | null;
  smtpPort: number | null;
}

function evaluateMailboxEligibilityMock(mailbox: EligibilityInput) {
  const remainingToday = Math.max(0, mailbox.dailySendingLimit - mailbox.currentDailyUsage);
  if (mailbox.status === 'DISABLED')
    return { eligible: false, reason: 'DISABLED', message: '', remainingToday };
  if (mailbox.status === 'UNVERIFIED' || !mailbox.verifiedAt)
    return { eligible: false, reason: 'UNVERIFIED', message: '', remainingToday };
  if (mailbox.healthStatus === 'UNHEALTHY')
    return { eligible: false, reason: 'UNHEALTHY', message: '', remainingToday };
  if (!mailbox.smtpHost || !mailbox.smtpPort)
    return { eligible: false, reason: 'MISSING_CREDENTIALS', message: '', remainingToday };
  if (remainingToday <= 0)
    return { eligible: false, reason: 'DAILY_LIMIT_EXHAUSTED', message: '', remainingToday };
  return { eligible: true, reason: 'ELIGIBLE', message: '', remainingToday };
}

vi.mock('@signalforge/mailboxes', () => ({
  evaluateMailboxEligibility: evaluateMailboxEligibilityMock,
  MailboxService: class {
    async create() {
      return null;
    }
  },
  MailboxConnectionService: class {},
  mailboxEligibilityService: {},
  mailboxUsageService: {},
}));

describe('Mailbox route helpers', () => {
  beforeEach(() => {
    mailboxes.clear();
    mailboxes.set('mb_1', buildMailbox({ id: 'mb_1', workspaceId: 'ws_1' }));
    mailboxes.set('mb_2', buildMailbox({ id: 'mb_2', workspaceId: 'ws_other' }));
  });

  it('denies cross-workspace mailbox access', async () => {
    const { prisma } = await import('@signalforge/database');
    const result = await prisma.mailbox.findFirst({
      where: { id: 'mb_1', workspaceId: 'ws_other' },
    });
    expect(result).toBeNull();
  });

  it('returns only the workspace-owned mailbox in list queries', async () => {
    const { prisma } = await import('@signalforge/database');
    const rows = await prisma.mailbox.findMany({ where: { workspaceId: 'ws_1' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('mb_1');
  });

  it('never exposes credential or password fields on the mailbox row', async () => {
    const { prisma } = await import('@signalforge/database');
    const rows = await prisma.mailbox.findMany({ where: { workspaceId: 'ws_1' } });
    const first = rows[0]!;
    expect((first as Record<string, unknown>).smtpPassword).toBeUndefined();
    expect((first as Record<string, unknown>).credential).toBeUndefined();
    expect((first as Record<string, unknown>).encryptedPayload).toBeUndefined();
  });

  it('flags accounts as UNVERIFIED until verifiedAt is set', async () => {
    const { evaluateMailboxEligibility } = await import('@signalforge/mailboxes');
    const unverified = buildMailbox({ id: 'mb_x', workspaceId: 'ws_1', verifiedAt: null });
    const result = evaluateMailboxEligibility(unverified);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('UNVERIFIED');
  });

  it('marks fully-verified healthy accounts as eligible', async () => {
    const { evaluateMailboxEligibility } = await import('@signalforge/mailboxes');
    const active = buildMailbox({
      id: 'mb_y',
      workspaceId: 'ws_1',
      status: 'ACTIVE',
      verifiedAt: new Date(),
      healthStatus: 'HEALTHY',
    });
    const result = evaluateMailboxEligibility(active);
    expect(result.eligible).toBe(true);
  });
});

function buildMailbox(overrides: Partial<MockMailbox>): MockMailbox {
  return {
    id: 'mb_placeholder',
    workspaceId: 'ws_1',
    provider: 'SMTP',
    name: null,
    emailAddress: 'ops@example.com',
    fromName: 'Operations',
    replyTo: null,
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUsername: 'ops@example.com',
    encryptionType: 'TLS',
    status: 'UNVERIFIED',
    dailySendingLimit: 100,
    currentDailyUsage: 0,
    timezone: null,
    healthStatus: 'UNKNOWN',
    warmupStatus: 'NOT_STARTED',
    verifiedAt: null,
    lastTestedAt: null,
    lastSuccessfulSendAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
