import { prisma } from '@signalforge/database';
import type { CandidateMailbox } from './eligibility.js';

export interface ResolvedCampaign {
  campaignId: string;
  workspaceId: string;
  sendingMode: 'MAILBOX_LIST' | 'SMTP_POOL' | 'SINGLE_MAILBOX';
  rotationStrategy: string;
  poolId: string | null;
  poolStrategy: string | null;
  poolEnabled: boolean;
  candidates: CandidateMailbox[];
}

export class CampaignNotFoundError extends Error {
  constructor(campaignId: string) {
    super(`Campaign ${campaignId} not found`);
    this.name = 'CampaignNotFoundError';
  }
}

export class InvalidSmtpConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSmtpConfigurationError';
  }
}

interface MailboxRow {
  id: string;
  status: string;
  healthStatus: string;
  dailySendingLimit: number;
  currentDailyUsage: number;
  verifiedAt: Date | null;
  smtpHost: string | null;
  smtpPort: number | null;
  credential: { id: string } | null;
}

interface UsageRow {
  reservedCount: number;
  warmupSentCount: number;
  warmupReservedCount: number;
}

async function loadUsageCounts(
  mailboxIds: string[],
  usageDate: Date,
): Promise<Map<string, UsageRow>> {
  if (mailboxIds.length === 0) return new Map();
  const rows = await prisma.mailboxDailyUsage.findMany({
    where: { mailboxId: { in: mailboxIds }, usageDate },
    select: {
      mailboxId: true,
      reservedCount: true,
      warmupSentCount: true,
      warmupReservedCount: true,
    },
  });
  return new Map(
    rows.map((r) => [
      r.mailboxId,
      {
        reservedCount: r.reservedCount,
        warmupSentCount: r.warmupSentCount,
        warmupReservedCount: r.warmupReservedCount,
      },
    ]),
  );
}

function buildCandidate(
  mailbox: MailboxRow,
  priority: number,
  poolMemberEnabled: boolean,
  usage: UsageRow | undefined,
): CandidateMailbox {
  return {
    id: mailbox.id,
    status: mailbox.status,
    healthStatus: mailbox.healthStatus,
    dailySendingLimit: mailbox.dailySendingLimit,
    currentDailyUsage: mailbox.currentDailyUsage,
    verifiedAt: mailbox.verifiedAt,
    smtpHost: mailbox.smtpHost,
    smtpPort: mailbox.smtpPort,
    credential: mailbox.credential ?? undefined,
    poolMemberEnabled,
    priority,
    reservedToday: usage?.reservedCount ?? 0,
    warmupSentToday: usage?.warmupSentCount ?? 0,
    warmupReservedToday: usage?.warmupReservedCount ?? 0,
  };
}

export async function resolveCampaignCandidates(
  campaignId: string,
  workspaceId: string,
  usageDate: Date,
): Promise<ResolvedCampaign> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: {
      smtpPool: {
        include: {
          members: {
            include: {
              mailbox: {
                include: { credential: { select: { id: true } } },
              },
            },
          },
        },
      },
      singleMailbox: {
        include: { credential: { select: { id: true } } },
      },
      mailboxes: {
        include: {
          mailbox: {
            include: { credential: { select: { id: true } } },
          },
        },
      },
    },
  });
  if (!campaign) throw new CampaignNotFoundError(campaignId);

  const base = {
    campaignId,
    workspaceId,
    sendingMode: campaign.sendingMode,
    rotationStrategy: campaign.rotationStrategy,
  } as const;

  if (campaign.sendingMode === 'SMTP_POOL') {
    if (!campaign.smtpPool) {
      throw new InvalidSmtpConfigurationError('Campaign is set to SMTP_POOL but has no pool');
    }
    const pool = campaign.smtpPool;
    const mailboxIds = pool.members.map((m) => m.mailboxId);
    const usage = await loadUsageCounts(mailboxIds, usageDate);
    const candidates = pool.members.map((m) =>
      buildCandidate(m.mailbox, m.priority, m.enabled, usage.get(m.mailboxId)),
    );
    return {
      ...base,
      poolId: pool.id,
      poolStrategy: pool.strategy,
      poolEnabled: pool.enabled,
      candidates,
    };
  }

  if (campaign.sendingMode === 'SINGLE_MAILBOX') {
    if (!campaign.singleMailbox) {
      throw new InvalidSmtpConfigurationError(
        'Campaign is set to SINGLE_MAILBOX but has no mailbox',
      );
    }
    const mailbox = campaign.singleMailbox;
    const usage = await loadUsageCounts([mailbox.id], usageDate);
    const candidates = [buildCandidate(mailbox, 0, true, usage.get(mailbox.id))];
    return {
      ...base,
      poolId: null,
      poolStrategy: null,
      poolEnabled: true,
      candidates,
    };
  }

  const members = campaign.mailboxes;
  const mailboxIds = members.map((m) => m.mailboxId);
  const usage = await loadUsageCounts(mailboxIds, usageDate);
  const candidates = members.map((m) =>
    buildCandidate(m.mailbox, 0, true, usage.get(m.mailboxId)),
  );
  return {
    ...base,
    poolId: null,
    poolStrategy: null,
    poolEnabled: true,
    candidates,
  };
}
