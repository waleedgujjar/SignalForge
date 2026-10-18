import { prisma } from '@signalforge/database';
import { deliverabilitySendGate, type DeliverabilityGateResult } from '@signalforge/deliverability';
import { evaluateSendingEligibility } from './eligibility-rules.js';
import type { SendingJobEligibilityReason, SendingJobEligibilityResult } from './types.js';

export { evaluateSendingEligibility };

export interface SendingEligibilityLookup {
  campaignLeadId: string;
  workspaceId: string;
  /// Mailbox the send would go out from, when already resolved. Omitted during
  /// scheduler dispatch, where allocation happens later in the pipeline.
  mailboxId?: string | null;
}

export class SendingEligibilityService {
  async check(input: SendingEligibilityLookup): Promise<SendingJobEligibilityResult> {
    const campaignLead = await prisma.campaignLead.findFirst({
      where: { id: input.campaignLeadId, campaign: { workspaceId: input.workspaceId } },
      include: {
        campaign: true,
        lead: true,
      },
    });

    if (!campaignLead) {
      return {
        eligible: false,
        reason: 'CAMPAIGN_LEAD_INACTIVE',
        message: 'Campaign lead not found.',
      };
    }

    const [suppressed, gate] = await Promise.all([
      prisma.suppression.findFirst({
        where: {
          workspaceId: input.workspaceId,
          OR: [
            { type: 'EMAIL', value: campaignLead.lead.email.toLowerCase() },
            { type: 'DOMAIN', value: extractDomain(campaignLead.lead.email) },
          ],
        },
      }),
      deliverabilitySendGate.check({
        workspaceId: input.workspaceId,
        mailboxId: input.mailboxId ?? null,
        email: campaignLead.lead.email,
      }),
    ]);

    return evaluateSendingEligibility({
      campaign: { status: campaignLead.campaign.status },
      campaignLead: { status: campaignLead.status },
      lead: { email: campaignLead.lead.email, status: campaignLead.lead.status },
      suppressed: Boolean(suppressed),
      deliverabilityBlock: toEligibilityReason(gate),
    });
  }
}

function toEligibilityReason(gate: DeliverabilityGateResult): SendingJobEligibilityReason | null {
  return gate.allowed ? null : gate.reason;
}

function extractDomain(email: string): string {
  const parts = email.split('@');
  const domain = parts.length === 2 ? parts[1] : '';
  return domain?.toLowerCase() ?? '';
}

export const sendingEligibilityService = new SendingEligibilityService();
