import type { CampaignActivityType, Prisma } from '@signalforge/database';
import { prisma } from '@signalforge/database';

export async function logCampaignActivity(input: {
  campaignId: string;
  workspaceId: string;
  type: CampaignActivityType;
  summary: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return prisma.campaignActivity.create({
    data: {
      campaignId: input.campaignId,
      workspaceId: input.workspaceId,
      type: input.type,
      summary: input.summary,
      actorUserId: input.actorUserId ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
