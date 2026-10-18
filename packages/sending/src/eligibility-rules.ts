import type { SendingJobEligibilityReason, SendingJobEligibilityResult } from './types.js';

const REASON_MESSAGES: Record<SendingJobEligibilityReason, string> = {
  ELIGIBLE: 'Lead is eligible for sending.',
  CAMPAIGN_NOT_ACTIVE: 'Campaign is not active.',
  CAMPAIGN_LEAD_INACTIVE: 'Campaign lead is not in a sendable state.',
  LEAD_ARCHIVED: 'Lead is archived.',
  LEAD_UNSUBSCRIBED: 'Lead has unsubscribed.',
  LEAD_BOUNCED: 'Lead email previously bounced.',
  LEAD_REPLIED: 'Lead has already replied.',
  LEAD_SUPPRESSED: 'Lead is on the suppression list.',
  INVALID_EMAIL: 'Lead email address is missing or invalid.',
  JOB_ALREADY_TERMINAL: 'Job is already in a terminal state.',
  CAMPAIGN_DAILY_LIMIT_REACHED: 'Campaign daily sending limit reached.',
  MAILBOX_CRITICAL_HEALTH: 'Mailbox health is critical; sending is held back to protect the sender.',
  MAILBOX_PAUSED: 'Mailbox is paused by deliverability protection.',
  RECIPIENT_SUPPRESSED: 'Recipient is suppressed due to bounce history.',
  RECIPIENT_SOFT_BOUNCE_AT_RISK: 'Recipient has repeated soft bounces and is held back from further sends.',
};

export interface LeadEligibilityLike {
  email: string;
  status: string;
}

export interface CampaignEligibilityLike {
  status: string;
}

export interface CampaignLeadEligibilityLike {
  status: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EvaluateSendingEligibilityInput {
  campaign: CampaignEligibilityLike;
  campaignLead: CampaignLeadEligibilityLike;
  lead: LeadEligibilityLike;
  suppressed?: boolean;
  /// Verdict from the Module 13 deliverability gate. Evaluated after the
  /// campaign and lead rules so the most specific reason still wins, and
  /// resolved by the caller because it requires database lookups.
  deliverabilityBlock?: SendingJobEligibilityReason | null;
}

export function evaluateSendingEligibility(
  input: EvaluateSendingEligibilityInput,
): SendingJobEligibilityResult {
  const { campaign, campaignLead, lead, suppressed, deliverabilityBlock } = input;

  if (campaign.status !== 'ACTIVE' && campaign.status !== 'SCHEDULED') {
    return build('CAMPAIGN_NOT_ACTIVE');
  }
  if (
    campaignLead.status === 'COMPLETED' ||
    campaignLead.status === 'STOPPED' ||
    campaignLead.status === 'PAUSED' ||
    campaignLead.status === 'UNSUBSCRIBED' ||
    campaignLead.status === 'BOUNCED'
  ) {
    return build('CAMPAIGN_LEAD_INACTIVE');
  }
  if (lead.status === 'ARCHIVED') {
    return build('LEAD_ARCHIVED');
  }
  if (lead.status === 'UNSUBSCRIBED') {
    return build('LEAD_UNSUBSCRIBED');
  }
  if (lead.status === 'BOUNCED') {
    return build('LEAD_BOUNCED');
  }
  if (lead.status === 'REPLIED') {
    return build('LEAD_REPLIED');
  }
  if (suppressed) {
    return build('LEAD_SUPPRESSED');
  }
  if (!lead.email || !EMAIL_REGEX.test(lead.email)) {
    return build('INVALID_EMAIL');
  }
  if (deliverabilityBlock) {
    return build(deliverabilityBlock);
  }
  return build('ELIGIBLE');
}

function build(reason: SendingJobEligibilityReason): SendingJobEligibilityResult {
  return { eligible: reason === 'ELIGIBLE', reason, message: REASON_MESSAGES[reason] };
}
