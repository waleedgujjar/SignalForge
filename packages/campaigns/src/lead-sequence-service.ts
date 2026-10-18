import { prisma } from '@signalforge/database';

export interface LeadSequenceStepView {
  stepId: string;
  order: number;
  label: string;
  subjectTemplate: string;
  delayAmount: number;
  delayUnit: string;
  enabled: boolean;
  jobStatus: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  state: 'sent' | 'scheduled' | 'pending' | 'cancelled' | 'failed' | 'skipped';
}

export interface LeadSequenceStatusView {
  campaignId: string;
  leadId: string;
  campaignLeadId: string;
  leadName: string | null;
  leadEmail: string;
  campaignName: string;
  status: string;
  stopReason: string | null;
  stoppedAt: string | null;
  currentStepOrder: number;
  followUpsEnabled: boolean;
  maxFollowUps: number;
  steps: LeadSequenceStepView[];
}

function stepLabel(order: number): string {
  return order === 0 ? 'Initial email' : `Follow-up #${order}`;
}

function resolveStepState(
  job: { status: string; scheduledAt: Date; sentAt: Date | null } | undefined,
  currentOrder: number,
  stepOrder: number,
): LeadSequenceStepView['state'] {
  if (!job) {
    return stepOrder <= currentOrder ? 'pending' : 'pending';
  }
  if (job.status === 'SENT') return 'sent';
  if (job.status === 'CANCELLED') return 'cancelled';
  if (job.status === 'FAILED') return 'failed';
  if (['SCHEDULED', 'RETRYING', 'PENDING', 'PROCESSING', 'PAUSED'].includes(job.status)) {
    return 'scheduled';
  }
  return 'pending';
}

export class LeadSequenceService {
  async getLeadSequenceStatus(
    campaignId: string,
    leadId: string,
    workspaceId: string,
  ): Promise<LeadSequenceStatusView | null> {
    const campaignLead = await prisma.campaignLead.findFirst({
      where: {
        campaignId,
        leadId,
        campaign: { workspaceId },
      },
      include: {
        lead: { select: { id: true, email: true, firstName: true, lastName: true } },
        campaign: {
          select: {
            id: true,
            name: true,
            followUpsEnabled: true,
            maxFollowUps: true,
            steps: { orderBy: { order: 'asc' } },
          },
        },
        sendingJobs: {
          include: { step: { select: { order: true } } },
        },
      },
    });

    if (!campaignLead) return null;

    const jobsByStepId = new Map(
      campaignLead.sendingJobs.map((job) => [job.sequenceStepId, job]),
    );

    const steps: LeadSequenceStepView[] = campaignLead.campaign.steps.map((step) => {
      const job = jobsByStepId.get(step.id);
      return {
        stepId: step.id,
        order: step.order,
        label: stepLabel(step.order),
        subjectTemplate: step.subjectTemplate,
        delayAmount: step.delayAmount,
        delayUnit: step.delayUnit,
        enabled: step.enabled,
        jobStatus: job?.status ?? null,
        scheduledAt: job?.scheduledAt?.toISOString() ?? null,
        sentAt: job?.sentAt?.toISOString() ?? null,
        state: resolveStepState(job, campaignLead.currentStepOrder, step.order),
      };
    });

    const leadName = [campaignLead.lead.firstName, campaignLead.lead.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    return {
      campaignId,
      leadId,
      campaignLeadId: campaignLead.id,
      leadName: leadName || null,
      leadEmail: campaignLead.lead.email,
      campaignName: campaignLead.campaign.name,
      status: campaignLead.status,
      stopReason: campaignLead.stopReason,
      stoppedAt: campaignLead.stoppedAt?.toISOString() ?? null,
      currentStepOrder: campaignLead.currentStepOrder,
      followUpsEnabled: campaignLead.campaign.followUpsEnabled,
      maxFollowUps: campaignLead.campaign.maxFollowUps,
      steps,
    };
  }
}

export const leadSequenceService = new LeadSequenceService();
