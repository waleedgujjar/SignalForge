import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@signalforge/database', () => ({
  prisma: {
    campaign: { findUnique: vi.fn() },
    campaignDailyUsage: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('./schedule-calculator.js', () => ({
  computeCampaignUsageDate: vi.fn(() => '2026-01-15'),
}));

import { prisma } from '@signalforge/database';
import { SendingLimitService } from './limits.js';

const campaignFindUnique = prisma.campaign.findUnique as ReturnType<typeof vi.fn>;
const usageFindUnique = prisma.campaignDailyUsage.findUnique as ReturnType<typeof vi.fn>;
const usageUpsert = prisma.campaignDailyUsage.upsert as ReturnType<typeof vi.fn>;

describe('SendingLimitService', () => {
  let service: SendingLimitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SendingLimitService();
  });

  describe('checkCampaignDailyLimit', () => {
    it('returns null when campaign not found', async () => {
      campaignFindUnique.mockResolvedValue(null);
      const result = await service.checkCampaignDailyLimit('c1');
      expect(result).toBeNull();
    });

    it('returns exhausted=false when no daily limit set', async () => {
      campaignFindUnique.mockResolvedValue({
        id: 'c1',
        dailySendingLimit: null,
        scheduleConfig: { timezone: 'UTC' },
        workspace: { timezone: 'UTC' },
      });
      usageFindUnique.mockResolvedValue({ sentCount: 50 });

      const result = await service.checkCampaignDailyLimit('c1');
      expect(result!.exhausted).toBe(false);
      expect(result!.remainingToday).toBeNull();
      expect(result!.dailyLimit).toBeNull();
      expect(result!.sentToday).toBe(50);
    });

    it('returns exhausted=true when daily limit reached', async () => {
      campaignFindUnique.mockResolvedValue({
        id: 'c1',
        dailySendingLimit: 100,
        scheduleConfig: { timezone: 'UTC' },
        workspace: { timezone: 'UTC' },
      });
      usageFindUnique.mockResolvedValue({ sentCount: 100 });

      const result = await service.checkCampaignDailyLimit('c1');
      expect(result!.exhausted).toBe(true);
      expect(result!.remainingToday).toBe(0);
      expect(result!.sentToday).toBe(100);
    });

    it('returns remaining count when under limit', async () => {
      campaignFindUnique.mockResolvedValue({
        id: 'c1',
        dailySendingLimit: 100,
        scheduleConfig: { timezone: 'America/New_York' },
        workspace: { timezone: 'America/New_York' },
      });
      usageFindUnique.mockResolvedValue({ sentCount: 40 });

      const result = await service.checkCampaignDailyLimit('c1');
      expect(result!.exhausted).toBe(false);
      expect(result!.remainingToday).toBe(60);
      expect(result!.sentToday).toBe(40);
    });

    it('handles no usage record (zero sent)', async () => {
      campaignFindUnique.mockResolvedValue({
        id: 'c1',
        dailySendingLimit: 50,
        scheduleConfig: {},
        workspace: { timezone: null },
      });
      usageFindUnique.mockResolvedValue(null);

      const result = await service.checkCampaignDailyLimit('c1');
      expect(result!.sentToday).toBe(0);
      expect(result!.remainingToday).toBe(50);
      expect(result!.exhausted).toBe(false);
    });

    it('uses workspace timezone as fallback', async () => {
      campaignFindUnique.mockResolvedValue({
        id: 'c1',
        dailySendingLimit: null,
        scheduleConfig: null,
        workspace: { timezone: 'Europe/London' },
      });
      usageFindUnique.mockResolvedValue(null);

      const result = await service.checkCampaignDailyLimit('c1');
      expect(result!.timezone).toBe('Europe/London');
    });

    it('falls back to UTC when no timezone available', async () => {
      campaignFindUnique.mockResolvedValue({
        id: 'c1',
        dailySendingLimit: null,
        scheduleConfig: {},
        workspace: { timezone: null },
      });
      usageFindUnique.mockResolvedValue(null);

      const result = await service.checkCampaignDailyLimit('c1');
      expect(result!.timezone).toBe('UTC');
    });
  });

  describe('incrementCampaignDailyUsage', () => {
    it('upserts usage record', async () => {
      usageUpsert.mockResolvedValue({});
      await service.incrementCampaignDailyUsage('c1', 'UTC');
      expect(usageUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { campaignId_usageDate: { campaignId: 'c1', usageDate: expect.any(Date) } },
          create: expect.objectContaining({ campaignId: 'c1', sentCount: 1 }),
          update: { sentCount: { increment: 1 } },
        }),
      );
    });
  });
});
