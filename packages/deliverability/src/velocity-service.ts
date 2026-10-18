import { prisma } from '@signalforge/database';
import { deliverabilityPolicyService } from './policy-service.js';
import type { VelocitySnapshot } from './types.js';

const BASELINE_DAYS = 7;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Reports how fast a mailbox is sending relative to its own recent baseline.
 *
 * Anomalies are surfaced as "potentially unusual activity" — a spike has many
 * innocent explanations (a new campaign launch, a raised limit), so this never
 * concludes that an account is compromised and never changes limits by itself.
 */
export class VelocityService {
  async getMailboxVelocity(workspaceId: string, mailboxId: string, now = new Date()): Promise<VelocitySnapshot> {
    const { thresholds } = await deliverabilityPolicyService.get(workspaceId);
    const today = startOfUtcDay(now);
    const baselineStart = new Date(today.getTime() - BASELINE_DAYS * 86_400_000);

    const [mailbox, todayUsage, baselineUsage, lastHour, last15] = await Promise.all([
      prisma.mailbox.findFirst({
        where: { id: mailboxId, workspaceId },
        select: { dailySendingLimit: true },
      }),
      prisma.mailboxDailyUsage.findUnique({
        where: { mailboxId_usageDate: { mailboxId, usageDate: today } },
        select: { sentCount: true, warmupSentCount: true },
      }),
      prisma.mailboxDailyUsage.findMany({
        where: { mailboxId, usageDate: { gte: baselineStart, lt: today } },
        select: { sentCount: true },
      }),
      prisma.emailMessage.count({
        where: {
          workspaceId,
          mailboxId,
          status: { in: ['SENT', 'BOUNCED'] },
          createdAt: { gte: new Date(now.getTime() - 3600_000) },
        },
      }),
      prisma.emailMessage.count({
        where: {
          workspaceId,
          mailboxId,
          status: { in: ['SENT', 'BOUNCED'] },
          createdAt: { gte: new Date(now.getTime() - 15 * 60_000) },
        },
      }),
    ]);

    const todaySent = (todayUsage?.sentCount ?? 0) + (todayUsage?.warmupSentCount ?? 0);
    const activeDays = baselineUsage.filter((row) => row.sentCount > 0);
    const baselinePerDay =
      activeDays.length > 0
        ? Math.round(activeDays.reduce((sum, row) => sum + row.sentCount, 0) / activeDays.length)
        : 0;

    // Require an established baseline before calling anything unusual.
    const anomalyDetected =
      baselinePerDay > 0 && todaySent > baselinePerDay * thresholds.velocityAnomalyMultiplier;

    return {
      today: todaySent,
      dailyLimit: mailbox?.dailySendingLimit ?? 0,
      lastHour,
      last15Minutes: last15,
      baselinePerDay,
      anomalyDetected,
      anomalyDescription: anomalyDetected
        ? `Sent ${todaySent} today against a recent average of ${baselinePerDay}/day. Potentially unusual activity.`
        : null,
    };
  }
}

export const velocityService = new VelocityService();
