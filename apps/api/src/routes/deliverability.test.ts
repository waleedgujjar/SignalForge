import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeliverabilityAlertService,
  DeliverabilityPolicyService,
  DeliverabilitySendGate,
} from '@signalforge/deliverability';

let alertService: DeliverabilityAlertService;
let policyService: DeliverabilityPolicyService;
let sendGate: DeliverabilitySendGate;

interface AlertRow {
  id: string;
  workspaceId: string;
  dedupeKey: string;
  status: string;
  entityType: string;
  entityId: string | null;
  alertType: string;
  resolvedAt: Date | null;
}

interface BounceStateRow {
  workspaceId: string;
  email: string;
  status: string;
  softBounceCount: number;
  hardBounceCount: number;
}

interface PolicyRow {
  workspaceId: string;
  protection: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  weights: Record<string, unknown>;
}

const alerts = new Map<string, AlertRow>();
const bounceStates = new Map<string, BounceStateRow>();
const policies = new Map<string, PolicyRow>();
const mailboxes = new Map<string, { id: string; workspaceId: string; status: string }>();

function bounceKey(workspaceId: string, email: string): string {
  return `${workspaceId}:${email}`;
}

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
    deliverabilityAlert: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { workspaceId_dedupeKey: { workspaceId: string; dedupeKey: string } };
        }) => {
          const { workspaceId, dedupeKey } = where.workspaceId_dedupeKey;
          return (
            [...alerts.values()].find(
              (row) => row.workspaceId === workspaceId && row.dedupeKey === dedupeKey,
            ) ?? null
          );
        },
      ),
      create: vi.fn(
        async ({ data }: { data: Omit<AlertRow, 'id' | 'resolvedAt'> & { status?: string } }) => {
          const id = `alert_${alerts.size + 1}`;
          const row: AlertRow = { ...data, id, status: data.status ?? 'OPEN', resolvedAt: null };
          alerts.set(id, row);
          return row;
        },
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<AlertRow> }) => {
        const row = alerts.get(where.id)!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; workspaceId: string };
          data: Partial<AlertRow>;
        }) => {
          const matched = [...alerts.values()].filter(
            (row) =>
              row.workspaceId === where.workspaceId && (!where.id || row.id === where.id),
          );
          for (const row of matched) Object.assign(row, data);
          return { count: matched.length };
        },
      ),
    },
    recipientBounceState: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { workspaceId_email: { workspaceId: string; email: string } };
        }) => {
          const { workspaceId, email } = where.workspaceId_email;
          return bounceStates.get(bounceKey(workspaceId, email)) ?? null;
        },
      ),
    },
    workspaceDeliverabilityPolicy: {
      findUnique: vi.fn(async ({ where }: { where: { workspaceId: string } }) => {
        return policies.get(where.workspaceId) ?? null;
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { workspaceId: string };
          create: PolicyRow;
        }) => {
          policies.set(where.workspaceId, create);
          return create;
        },
      ),
    },
    mailbox: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; workspaceId: string } }) => {
        const row = mailboxes.get(where.id);
        if (!row || row.workspaceId !== where.workspaceId) return null;
        return { ...row, health: null };
      }),
    },
  },
}));

beforeAll(async () => {
  const deliverability = await import('@signalforge/deliverability');
  alertService = deliverability.deliverabilityAlertService;
  policyService = deliverability.deliverabilityPolicyService;
  sendGate = deliverability.deliverabilitySendGate;
}, 30_000);

beforeEach(() => {
  alerts.clear();
  bounceStates.clear();
  policies.clear();
  mailboxes.clear();

  mailboxes.set('mb_ws1', { id: 'mb_ws1', workspaceId: 'ws_1', status: 'ACTIVE' });
  mailboxes.set('mb_ws2', { id: 'mb_ws2', workspaceId: 'ws_2', status: 'DISABLED' });

  bounceStates.set(bounceKey('ws_2', 'shared@example.com'), {
    workspaceId: 'ws_2',
    email: 'shared@example.com',
    status: 'SUPPRESSED',
    softBounceCount: 0,
    hardBounceCount: 1,
  });
});

describe('Deliverability alert workspace isolation', () => {
  const alertInput = {
    severity: 'WARNING' as const,
    alertType: 'ELEVATED_BOUNCE_RATE' as const,
    entityType: 'MAILBOX' as const,
    entityId: 'mb_1',
    title: 'Elevated bounce rate',
    message: 'Bounce rate is elevated.',
    occurredAt: new Date('2026-03-04T10:00:00.000Z'),
  };

  it('deduplicates a repeated alert within the same workspace and day', async () => {
    const first = await alertService.raise({ workspaceId: 'ws_1', ...alertInput });
    const second = await alertService.raise({
      workspaceId: 'ws_1',
      ...alertInput,
      occurredAt: new Date('2026-03-04T22:00:00.000Z'),
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(alerts.size).toBe(1);
  });

  it('does not collapse the same condition across two workspaces', async () => {
    const first = await alertService.raise({ workspaceId: 'ws_1', ...alertInput });
    const second = await alertService.raise({ workspaceId: 'ws_2', ...alertInput });

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(alerts.size).toBe(2);
  });

  it('refuses to update an alert belonging to another workspace', async () => {
    const { id } = await alertService.raise({ workspaceId: 'ws_1', ...alertInput });

    const denied = await alertService.updateStatus('ws_2', id, 'RESOLVED');
    expect(denied).toBe(false);
    expect(alerts.get(id)?.status).toBe('OPEN');

    const allowed = await alertService.updateStatus('ws_1', id, 'RESOLVED');
    expect(allowed).toBe(true);
    expect(alerts.get(id)?.status).toBe('RESOLVED');
  });
});

describe('Deliverability policy workspace isolation', () => {
  it('falls back to conservative defaults for a workspace with no stored policy', async () => {
    const policy = await policyService.get('ws_1');
    expect(policy.protection.pauseLeadOnHardBounce).toBe(true);
    expect(policy.protection.stopOnUnsubscribed).toBe(true);
  });

  it('keeps one workspace policy change from affecting another', async () => {
    await policyService.update('ws_1', {
      thresholds: { criticalBounceRatePercent: 12 },
    });

    const updated = await policyService.get('ws_1');
    const untouched = await policyService.get('ws_2');

    expect(updated.thresholds.criticalBounceRatePercent).toBe(12);
    expect(untouched.thresholds.criticalBounceRatePercent).toBe(5);
  });

  it('merges a partial update over current values rather than resetting omitted fields', async () => {
    await policyService.update('ws_1', { thresholds: { criticalBounceRatePercent: 12 } });
    await policyService.update('ws_1', { thresholds: { warningBounceRatePercent: 4 } });

    const policy = await policyService.get('ws_1');
    expect(policy.thresholds.criticalBounceRatePercent).toBe(12);
    expect(policy.thresholds.warningBounceRatePercent).toBe(4);
  });
});

describe('Deliverability send gate workspace isolation', () => {
  it('does not apply another workspace recipient suppression', async () => {
    const blocked = await sendGate.checkRecipient('ws_2', 'shared@example.com');
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe('RECIPIENT_SUPPRESSED');

    const allowed = await sendGate.checkRecipient('ws_1', 'shared@example.com');
    expect(allowed.allowed).toBe(true);
  });

  it('normalizes recipient casing so suppression cannot be bypassed', async () => {
    const result = await sendGate.checkRecipient('ws_2', '  Shared@Example.COM ');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('RECIPIENT_SUPPRESSED');
  });

  it('ignores a paused mailbox that belongs to another workspace', async () => {
    const crossWorkspace = await sendGate.checkMailbox('ws_1', 'mb_ws2');
    expect(crossWorkspace.allowed).toBe(true);

    const ownMailbox = await sendGate.checkMailbox('ws_2', 'mb_ws2');
    expect(ownMailbox.allowed).toBe(false);
    expect(ownMailbox.reason).toBe('MAILBOX_PAUSED');
  });
});
