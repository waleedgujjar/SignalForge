import { prisma } from '@signalforge/database';
import { computeCampaignUsageDate } from './schedule-calculator.js';

const DEFAULT_TIMEZONE = 'UTC';

export interface CampaignLimitCheckResult {
  campaignId: string;
  timezone: string;
  usageDate: string;
  dailyLimit: number | null;
  sentToday: number;
  remainingToday: number | null;
  exhausted: boolean;
}

export class SendingLimitService {
  async checkCampaignDailyLimit(campaignId: string): Promise<CampaignLimitCheckResult | null> {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { workspace: true },
    });
    if (!campaign) return null;

    const schedule = (campaign.scheduleConfig ?? {}) as { timezone?: string };
    const timezone = schedule.timezone ?? campaign.workspace.timezone ?? DEFAULT_TIMEZONE;
    const usageDate = computeCampaignUsageDate(new Date(), timezone);
    const usage = await prisma.campaignDailyUsage.findUnique({
      where: {
        campaignId_usageDate: {
          campaignId,
          usageDate: new Date(`${usageDate}T00:00:00Z`),
        },
      },
    });

    const sentToday = usage?.sentCount ?? 0;
    const dailyLimit = campaign.dailySendingLimit ?? null;
    const remainingToday = dailyLimit !== null ? Math.max(0, dailyLimit - sentToday) : null;
    const exhausted = dailyLimit !== null && sentToday >= dailyLimit;

    return {
      campaignId,
      timezone,
      usageDate,
      dailyLimit,
      sentToday,
      remainingToday,
      exhausted,
    };
  }

  async incrementCampaignDailyUsage(campaignId: string, timezone: string): Promise<void> {
    const usageDate = computeCampaignUsageDate(new Date(), timezone);
    await prisma.campaignDailyUsage.upsert({
      where: {
        campaignId_usageDate: {
          campaignId,
          usageDate: new Date(`${usageDate}T00:00:00Z`),
        },
      },
      create: {
        campaignId,
        usageDate: new Date(`${usageDate}T00:00:00Z`),
        sentCount: 1,
      },
      update: {
        sentCount: { increment: 1 },
      },
    });
  }
}

export const sendingLimitService = new SendingLimitService();
