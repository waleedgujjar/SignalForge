import { prisma } from '@signalforge/database';
import { computeUsageDate, toUsageDate } from './usage-date.js';
import type { RemainingCapacity, UsageSummary } from './types.js';

const DEFAULT_TIMEZONE = 'UTC';

export { computeUsageDate, toUsageDate };

export class MailboxUsageService {
  async getUsageSummary(mailboxId: string, workspaceId: string): Promise<UsageSummary | null> {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
      include: { workspace: true },
    });
    if (!mailbox) return null;

    const timezone = mailbox.timezone ?? mailbox.workspace.timezone ?? DEFAULT_TIMEZONE;
    const usageDate = computeUsageDate(new Date(), timezone);
    const usage = await prisma.mailboxDailyUsage.findUnique({
      where: {
        mailboxId_usageDate: {
          mailboxId,
          usageDate: toUsageDate(usageDate),
        },
      },
    });

    const sentToday = usage?.sentCount ?? mailbox.currentDailyUsage;
    return {
      dailySendingLimit: mailbox.dailySendingLimit,
      sentToday,
      remainingToday: Math.max(0, mailbox.dailySendingLimit - sentToday),
      usageDate,
      timezone,
    };
  }

  async getRemainingCapacity(
    mailboxId: string,
    workspaceId: string,
  ): Promise<RemainingCapacity | null> {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
      include: { workspace: true, warmupConfig: true },
    });
    if (!mailbox) return null;

    const timezone = mailbox.timezone ?? mailbox.workspace.timezone ?? DEFAULT_TIMEZONE;
    const usageDate = computeUsageDate(new Date(), timezone);
    const usage = await prisma.mailboxDailyUsage.findUnique({
      where: {
        mailboxId_usageDate: {
          mailboxId,
          usageDate: toUsageDate(usageDate),
        },
      },
    });

    const campaignSentToday = usage?.sentCount ?? 0;
    const campaignReservedToday = usage?.reservedCount ?? 0;
    const warmupSentToday = usage?.warmupSentCount ?? 0;
    const warmupReservedToday = usage?.warmupReservedCount ?? 0;
    const totalUsed =
      campaignSentToday + campaignReservedToday + warmupSentToday + warmupReservedToday;
    const accountRemaining = Math.max(0, mailbox.dailySendingLimit - totalUsed);
    const campaignRemaining = accountRemaining;
    const warmupDailyLimit = mailbox.warmupConfig?.currentDailyLimit ?? null;
    const warmupRemaining =
      warmupDailyLimit === null
        ? 0
        : Math.min(
            accountRemaining,
            Math.max(0, warmupDailyLimit - warmupSentToday - warmupReservedToday),
          );

    return {
      campaignRemaining,
      warmupRemaining,
      accountRemaining,
      dailySendingLimit: mailbox.dailySendingLimit,
      warmupDailyLimit,
      campaignSentToday,
      campaignReservedToday,
      warmupSentToday,
      warmupReservedToday,
      usageDate,
      timezone,
    };
  }

  async resetIfNewDay(mailboxId: string, workspaceId: string): Promise<UsageSummary | null> {
    const mailbox = await prisma.mailbox.findFirst({
      where: { id: mailboxId, workspaceId },
      include: { workspace: true },
    });
    if (!mailbox) return null;

    const timezone = mailbox.timezone ?? mailbox.workspace.timezone ?? DEFAULT_TIMEZONE;
    const now = new Date();
    const today = computeUsageDate(now, timezone);
    const lastReset = mailbox.usageResetAt;
    const lastResetDate = lastReset ? computeUsageDate(lastReset, timezone) : null;

    if (lastResetDate !== today) {
      await prisma.mailbox.update({
        where: { id: mailboxId },
        data: { currentDailyUsage: 0, usageResetAt: now },
      });
    }

    return this.getUsageSummary(mailboxId, workspaceId);
  }
}

export const mailboxUsageService = new MailboxUsageService();
