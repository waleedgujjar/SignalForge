import { prisma } from '@signalforge/database';
import { delayToDays } from './delays.js';
import type { CampaignExecutionJob } from './types.js';

export class CampaignExecutionPlanner {
  async buildPlan(campaignId: string, workspaceId: string): Promise<CampaignExecutionJob[]> {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, workspaceId },
      include: {
        steps: { where: { enabled: true }, orderBy: { order: 'asc' } },
        campaignLeads: true,
      },
    });

    if (!campaign) throw new Error('Campaign not found');

    const baseTime = campaign.launchedAt ?? campaign.scheduledAt ?? new Date();
    const jobs: CampaignExecutionJob[] = [];

    for (const campaignLead of campaign.campaignLeads) {
      let cumulativeDays = 0;

      for (const step of campaign.steps) {
        cumulativeDays += delayToDays(step.delayAmount, step.delayUnit);
        const scheduledAt = new Date(baseTime.getTime() + cumulativeDays * 24 * 60 * 60 * 1000);

        jobs.push({
          campaignId: campaign.id,
          campaignLeadId: campaignLead.id,
          leadId: campaignLead.leadId,
          sequenceStepId: step.id,
          scheduledAt: scheduledAt.toISOString(),
          workspaceId,
        });
      }
    }

    return jobs.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }
}

export const campaignExecutionPlanner = new CampaignExecutionPlanner();
