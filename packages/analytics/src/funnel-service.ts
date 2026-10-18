import { analyticsCountersService, type FunnelCounts, type LeadWindow } from './metrics/counters.js';
import { leadRate } from './metrics/formulas.js';
import type { FunnelResult, FunnelStage, FunnelStep } from './types.js';

const STAGE_ORDER: Array<{ stage: FunnelStage; label: string; key: keyof FunnelCounts }> = [
  { stage: 'IMPORTED', label: 'Imported', key: 'imported' },
  { stage: 'VERIFIED', label: 'Verified', key: 'verified' },
  { stage: 'QUALIFIED', label: 'Qualified', key: 'qualified' },
  { stage: 'CONTACTED', label: 'Contacted', key: 'contacted' },
  { stage: 'REPLIED', label: 'Replied', key: 'replied' },
  { stage: 'POSITIVE_REPLY', label: 'Positive reply', key: 'positiveReply' },
  { stage: 'MEETING', label: 'Meeting booked', key: 'meeting' },
];

/// Published alongside the numbers so anyone can check what a stage counts.
export const FUNNEL_DEFINITIONS: Record<FunnelStage, string> = {
  IMPORTED: 'Leads created in this workspace during the selected range.',
  VERIFIED: 'Leads whose email verification returned VERIFIED.',
  QUALIFIED: 'Leads marked QUALIFIED, or scored HIGH/VERY_HIGH by enrichment.',
  CONTACTED: 'Leads with at least one successful send, or status CONTACTED or later.',
  REPLIED: 'Leads with at least one inbound reply matched to a conversation.',
  POSITIVE_REPLY: 'Leads whose reply was classified POSITIVE or INTERESTED.',
  MEETING: 'Leads with a MEETING_BOOKED outcome recorded manually or via the API.',
};

/**
 * Builds the lead funnel for a cohort of leads created in the range.
 *
 * Stages are not guaranteed to be strictly decreasing: a lead can be contacted
 * without ever being verified, for instance. Rather than force monotonicity by
 * inventing numbers, each step reports its own count plus conversion against
 * both the previous stage and the top of the funnel.
 */
export class FunnelService {
  async getFunnel(window: LeadWindow): Promise<FunnelResult> {
    const counts = await analyticsCountersService.getFunnelCounts(window);
    return buildFunnel(counts);
  }
}

export function buildFunnel(counts: FunnelCounts): FunnelResult {
  const top = counts[STAGE_ORDER[0]!.key];
  const steps: FunnelStep[] = STAGE_ORDER.map((definition, index) => {
    const count = counts[definition.key];
    const previous = index === 0 ? null : counts[STAGE_ORDER[index - 1]!.key];

    return {
      stage: definition.stage,
      label: definition.label,
      count,
      conversionFromPrevious:
        previous === null
          ? null
          : leadRate(count, previous, `${STAGE_ORDER[index - 1]!.label.toLowerCase()} leads`),
      conversionFromTop: index === 0 ? null : leadRate(count, top, 'imported leads'),
      dropOff: previous === null ? 0 : Math.max(0, previous - count),
    };
  });

  return { steps, definitions: FUNNEL_DEFINITIONS };
}

export const funnelService = new FunnelService();
