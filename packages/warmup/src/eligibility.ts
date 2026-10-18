import { prisma } from '@signalforge/database';
import { computeUsageDate, isWithinWarmupWindow, toUsageDate } from './schedule-calculator.js';
import type { WarmupEligibilityResult, WarmupIneligibilityReason } from './types.js';

const REASON_MESSAGES: Record<WarmupIneligibilityReason, string> = {
  ELIGIBLE: 'Eligible for warmup send.',
  WARMUP_DISABLED: 'Warmup is disabled for this mailbox.',
  WARMUP_PAUSED: 'Warmup is paused for this mailbox.',
  WARMUP_BLOCKED: 'Warmup is blocked after repeated failures.',
  WARMUP_COMPLETED: 'Warmup has completed.',
  WARMUP_NOT_STARTED: 'Warmup has not been started.',
  WARMUP_DAILY_LIMIT_REACHED: 'Warmup daily limit reached.',
  ACCOUNT_DAILY_LIMIT_REACHED: 'Account daily sending limit reached.',
  OUTSIDE_SENDING_WINDOW: 'Outside configured sending window.',
  MAILBOX_UNHEALTHY: 'Mailbox health is unhealthy.',
  MAILBOX_DISABLED: 'Mailbox is disabled.',
  MAILBOX_UNVERIFIED: 'Mailbox has not been verified.',
  MAILBOX_NOT_FOUND: 'Mailbox not found in workspace.',
  MISSING_CREDENTIALS: 'Mailbox is missing SMTP credentials.',
  NO_WARMUP_RECIPIENTS: 'No authorized warmup recipients are configured.',
  NO_ELIGIBLE_RECIPIENT: 'No eligible warmup recipient available right now.',
};

function ineligible(
  reason: WarmupIneligibilityReason,
  extra: Partial<WarmupEligibilityResult> = {},
): WarmupEligibilityResult {
  return {
    eligible: false,
    reason,
    message: REASON_MESSAGES[reason],
    remainingCapacity: 0,
    warmupRemaining: 0,
    accountRemaining: 0,
    configuredLimit: 0,
    ...extra,
  };
}

/**
 * Compute warmup eligibility for a given mailbox in a workspace. Returns
 * remaining warmup capacity for today (bounded by both the warmup limit and
 * the shared account daily limit), along with the top-level reason.
 */
export async function getWarmupEligibility(
  mailboxId: string,
  workspaceId: string,
  now: Date = new Date(),
): Promise<WarmupEligibilityResult> {
  const mailbox = await prisma.mailbox.findFirst({
    where: { id: mailboxId, workspaceId },
    include: {
      workspace: true,
      warmupConfig: true,
      credential: { select: { id: true } },
    },
  });
  if (!mailbox) return ineligible('MAILBOX_NOT_FOUND');
  if (mailbox.status === 'DISABLED') return ineligible('MAILBOX_DISABLED');
  if (mailbox.status !== 'ACTIVE' || !mailbox.verifiedAt) {
    return ineligible('MAILBOX_UNVERIFIED');
  }
  if (mailbox.healthStatus === 'UNHEALTHY') return ineligible('MAILBOX_UNHEALTHY');
  if (!mailbox.credential || !mailbox.smtpHost || !mailbox.smtpPort) {
    return ineligible('MISSING_CREDENTIALS');
  }

  const config = mailbox.warmupConfig;
  if (!config || !config.enabled) return ineligible('WARMUP_DISABLED');
  if (config.status === 'PAUSED') return ineligible('WARMUP_PAUSED');
  if (config.status === 'BLOCKED') return ineligible('WARMUP_BLOCKED');
  if (config.status === 'COMPLETED') return ineligible('WARMUP_COMPLETED');
  if (config.status === 'NOT_STARTED' || config.status === 'DISABLED') {
    return ineligible('WARMUP_NOT_STARTED');
  }

  const timezone = config.timezone || mailbox.timezone || mailbox.workspace.timezone || 'UTC';
  const scheduleConfig = {
    timezone,
    weekdays: parseWeekdays(config.weekdays),
    windowStart: config.windowStart,
    windowEnd: config.windowEnd,
  };
  if (!isWithinWarmupWindow(now, scheduleConfig)) {
    return ineligible('OUTSIDE_SENDING_WINDOW', { configuredLimit: config.currentDailyLimit });
  }

  const usageDate = computeUsageDate(now, timezone);
  const usage = await prisma.mailboxDailyUsage.findUnique({
    where: {
      mailboxId_usageDate: { mailboxId, usageDate: toUsageDate(usageDate) },
    },
  });

  const warmupUsed = (usage?.warmupSentCount ?? 0) + (usage?.warmupReservedCount ?? 0);
  const accountUsed =
    (usage?.sentCount ?? 0) +
    (usage?.reservedCount ?? 0) +
    (usage?.warmupSentCount ?? 0) +
    (usage?.warmupReservedCount ?? 0);

  const warmupRemaining = Math.max(0, config.currentDailyLimit - warmupUsed);
  const accountRemaining = Math.max(0, mailbox.dailySendingLimit - accountUsed);
  const remainingCapacity = Math.min(warmupRemaining, accountRemaining);

  if (warmupRemaining <= 0) {
    return ineligible('WARMUP_DAILY_LIMIT_REACHED', {
      configuredLimit: config.currentDailyLimit,
      warmupRemaining,
      accountRemaining,
    });
  }
  if (accountRemaining <= 0) {
    return ineligible('ACCOUNT_DAILY_LIMIT_REACHED', {
      configuredLimit: config.currentDailyLimit,
      warmupRemaining,
      accountRemaining,
    });
  }

  const eligibleRecipientCount = await prisma.warmupRecipient.count({
    where: { workspaceId, enabled: true, consentConfirmed: true },
  });
  if (eligibleRecipientCount === 0) {
    return ineligible('NO_WARMUP_RECIPIENTS', {
      configuredLimit: config.currentDailyLimit,
      warmupRemaining,
      accountRemaining,
    });
  }

  return {
    eligible: true,
    reason: 'ELIGIBLE',
    message: REASON_MESSAGES.ELIGIBLE,
    remainingCapacity,
    warmupRemaining,
    accountRemaining,
    configuredLimit: config.currentDailyLimit,
  };
}

export function parseWeekdays(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is number => Number.isInteger(v) && v >= 0 && v <= 6);
  }
  return [1, 2, 3, 4, 5];
}
