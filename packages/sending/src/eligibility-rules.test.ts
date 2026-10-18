import { describe, expect, it } from 'vitest';
import { evaluateSendingEligibility } from './eligibility-rules.js';
import type { SendingJobEligibilityReason } from './types.js';

function build(overrides?: {
  campaignStatus?: string;
  campaignLeadStatus?: string;
  leadStatus?: string;
  email?: string;
  suppressed?: boolean;
  deliverabilityBlock?: SendingJobEligibilityReason | null;
}) {
  return {
    campaign: { status: overrides?.campaignStatus ?? 'ACTIVE' },
    campaignLead: { status: overrides?.campaignLeadStatus ?? 'ACTIVE' },
    lead: { email: overrides?.email ?? 'lead@example.com', status: overrides?.leadStatus ?? 'NEW' },
    suppressed: overrides?.suppressed ?? false,
    deliverabilityBlock: overrides?.deliverabilityBlock ?? null,
  };
}

describe('evaluateSendingEligibility', () => {
  it('marks a happy path lead as eligible', () => {
    const result = evaluateSendingEligibility(build());
    expect(result.eligible).toBe(true);
    expect(result.reason).toBe('ELIGIBLE');
  });

  it('rejects when campaign is not active', () => {
    const result = evaluateSendingEligibility(build({ campaignStatus: 'PAUSED' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('CAMPAIGN_NOT_ACTIVE');
  });

  it('rejects when campaign lead is completed', () => {
    const result = evaluateSendingEligibility(build({ campaignLeadStatus: 'COMPLETED' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('CAMPAIGN_LEAD_INACTIVE');
  });

  it('rejects unsubscribed leads', () => {
    const result = evaluateSendingEligibility(build({ leadStatus: 'UNSUBSCRIBED' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('LEAD_UNSUBSCRIBED');
  });

  it('rejects bounced leads', () => {
    const result = evaluateSendingEligibility(build({ leadStatus: 'BOUNCED' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('LEAD_BOUNCED');
  });

  it('rejects replied leads', () => {
    const result = evaluateSendingEligibility(build({ leadStatus: 'REPLIED' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('LEAD_REPLIED');
  });

  it('rejects when suppressed', () => {
    const result = evaluateSendingEligibility(build({ suppressed: true }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('LEAD_SUPPRESSED');
  });

  it('rejects invalid emails', () => {
    const result = evaluateSendingEligibility(build({ email: 'not-an-email' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('INVALID_EMAIL');
  });

  it('blocks a send when the deliverability gate holds back the recipient', () => {
    const result = evaluateSendingEligibility(
      build({ deliverabilityBlock: 'RECIPIENT_SOFT_BOUNCE_AT_RISK' }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('RECIPIENT_SOFT_BOUNCE_AT_RISK');
    expect(result.message).toContain('soft bounces');
  });

  it('blocks a send from a mailbox paused by deliverability protection', () => {
    const result = evaluateSendingEligibility(build({ deliverabilityBlock: 'MAILBOX_PAUSED' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('MAILBOX_PAUSED');
  });

  it('reports the more specific campaign or lead reason ahead of the deliverability block', () => {
    const result = evaluateSendingEligibility(
      build({ leadStatus: 'UNSUBSCRIBED', deliverabilityBlock: 'MAILBOX_CRITICAL_HEALTH' }),
    );
    expect(result.reason).toBe('LEAD_UNSUBSCRIBED');
  });

  it('stays eligible when the deliverability gate raises no objection', () => {
    expect(evaluateSendingEligibility(build({ deliverabilityBlock: null })).eligible).toBe(true);
  });
});
