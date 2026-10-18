import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MailboxRow {
  id: string;
  workspaceId: string;
  status: string;
  healthStatus: string;
  verifiedAt: Date | null;
  smtpHost: string | null;
  smtpPort: number | null;
  timezone: string | null;
  dailySendingLimit: number;
  workspace: { timezone: string | null };
  warmupConfig: {
    enabled: boolean;
    status: string;
    currentDailyLimit: number;
    timezone: string;
    weekdays: number[];
    windowStart: string;
    windowEnd: string;
  } | null;
  credential: { id: string } | null;
}

interface UsageRow {
  sentCount: number;
  reservedCount: number;
  warmupSentCount: number;
  warmupReservedCount: number;
}

let mailboxRow: MailboxRow | null = null;
let usageRow: UsageRow | null = null;
let recipientCount = 1;

vi.mock('@signalforge/database', () => ({
  prisma: {
    mailbox: {
      findFirst: async ({ where }: { where: { id: string; workspaceId: string } }) => {
        if (!mailboxRow) return null;
        if (mailboxRow.id !== where.id || mailboxRow.workspaceId !== where.workspaceId) return null;
        return mailboxRow;
      },
    },
    mailboxDailyUsage: {
      findUnique: async () => usageRow,
    },
    warmupRecipient: {
      count: async () => recipientCount,
    },
  },
}));

function baseMailbox(overrides: Partial<MailboxRow> = {}): MailboxRow {
  return {
    id: 'mb_1',
    workspaceId: 'ws_1',
    status: 'ACTIVE',
    healthStatus: 'HEALTHY',
    verifiedAt: new Date('2026-01-01T00:00:00Z'),
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    timezone: 'UTC',
    dailySendingLimit: 100,
    workspace: { timezone: 'UTC' },
    warmupConfig: {
      enabled: true,
      status: 'ACTIVE',
      currentDailyLimit: 10,
      timezone: 'UTC',
      weekdays: [1, 2, 3, 4, 5],
      windowStart: '09:00',
      windowEnd: '17:00',
    },
    credential: { id: 'cred_1' },
    ...overrides,
  };
}

beforeEach(() => {
  mailboxRow = null;
  usageRow = null;
  recipientCount = 1;
});

describe('getWarmupEligibility', () => {
  it('returns MAILBOX_NOT_FOUND when mailbox is missing', async () => {
    const { getWarmupEligibility } = await import('./eligibility.js');
    const result = await getWarmupEligibility('mb_missing', 'ws_1');
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('MAILBOX_NOT_FOUND');
  });

  it('is ineligible when warmup is disabled', async () => {
    mailboxRow = baseMailbox({
      warmupConfig: { ...baseMailbox().warmupConfig!, enabled: false },
    });
    const { getWarmupEligibility } = await import('./eligibility.js');
    const result = await getWarmupEligibility('mb_1', 'ws_1');
    expect(result.reason).toBe('WARMUP_DISABLED');
  });

  it('is ineligible when warmup status is BLOCKED', async () => {
    mailboxRow = baseMailbox({
      warmupConfig: { ...baseMailbox().warmupConfig!, status: 'BLOCKED' },
    });
    const { getWarmupEligibility } = await import('./eligibility.js');
    const result = await getWarmupEligibility('mb_1', 'ws_1');
    expect(result.reason).toBe('WARMUP_BLOCKED');
  });

  it('is ineligible when outside sending window', async () => {
    mailboxRow = baseMailbox();
    const { getWarmupEligibility } = await import('./eligibility.js');
    // 03:00 UTC on a weekday, outside 09-17 window
    const result = await getWarmupEligibility('mb_1', 'ws_1', new Date('2026-01-05T03:00:00Z'));
    expect(result.reason).toBe('OUTSIDE_SENDING_WINDOW');
  });

  it('caps remaining capacity at the smaller of warmup or account remaining', async () => {
    mailboxRow = baseMailbox({ dailySendingLimit: 8 });
    usageRow = {
      sentCount: 5,
      reservedCount: 0,
      warmupSentCount: 1,
      warmupReservedCount: 0,
    };
    const { getWarmupEligibility } = await import('./eligibility.js');
    const result = await getWarmupEligibility('mb_1', 'ws_1', new Date('2026-01-05T12:00:00Z'));
    expect(result.eligible).toBe(true);
    // warmup remaining = 10 - 1 = 9; account remaining = 8 - (5+0+1) = 2
    expect(result.warmupRemaining).toBe(9);
    expect(result.accountRemaining).toBe(2);
    expect(result.remainingCapacity).toBe(2);
  });

  it('reports WARMUP_DAILY_LIMIT_REACHED when warmup limit is exhausted', async () => {
    mailboxRow = baseMailbox();
    usageRow = {
      sentCount: 0,
      reservedCount: 0,
      warmupSentCount: 10,
      warmupReservedCount: 0,
    };
    const { getWarmupEligibility } = await import('./eligibility.js');
    const result = await getWarmupEligibility('mb_1', 'ws_1', new Date('2026-01-05T12:00:00Z'));
    expect(result.reason).toBe('WARMUP_DAILY_LIMIT_REACHED');
  });

  it('reports ACCOUNT_DAILY_LIMIT_REACHED when only account cap is exhausted', async () => {
    mailboxRow = baseMailbox({ dailySendingLimit: 5 });
    usageRow = {
      sentCount: 5,
      reservedCount: 0,
      warmupSentCount: 0,
      warmupReservedCount: 0,
    };
    const { getWarmupEligibility } = await import('./eligibility.js');
    const result = await getWarmupEligibility('mb_1', 'ws_1', new Date('2026-01-05T12:00:00Z'));
    expect(result.reason).toBe('ACCOUNT_DAILY_LIMIT_REACHED');
  });

  it('reports NO_WARMUP_RECIPIENTS when no authorized recipients exist', async () => {
    mailboxRow = baseMailbox();
    recipientCount = 0;
    const { getWarmupEligibility } = await import('./eligibility.js');
    const result = await getWarmupEligibility('mb_1', 'ws_1', new Date('2026-01-05T12:00:00Z'));
    expect(result.reason).toBe('NO_WARMUP_RECIPIENTS');
  });

  it('is ineligible when mailbox is disabled', async () => {
    mailboxRow = baseMailbox({ status: 'DISABLED' });
    const { getWarmupEligibility } = await import('./eligibility.js');
    const result = await getWarmupEligibility('mb_1', 'ws_1');
    expect(result.reason).toBe('MAILBOX_DISABLED');
  });

  it('is ineligible when mailbox health is UNHEALTHY', async () => {
    mailboxRow = baseMailbox({ healthStatus: 'UNHEALTHY' });
    const { getWarmupEligibility } = await import('./eligibility.js');
    const result = await getWarmupEligibility('mb_1', 'ws_1');
    expect(result.reason).toBe('MAILBOX_UNHEALTHY');
  });
});
