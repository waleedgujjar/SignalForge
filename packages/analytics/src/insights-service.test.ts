import { describe, expect, it } from 'vitest';

import { buildFunnel } from './funnel-service.js';
import { buildInsights, type InsightInput } from './insights-service.js';
import { buildRate, leadRate } from './metrics/formulas.js';
import { MIN_SENDS_FOR_RATE } from './types.js';
import type {
  CampaignAnalyticsRow,
  DeliveryCounters,
  DeliveryRates,
  MailboxAnalyticsRow,
  ReplyAnalytics,
} from './types.js';

function counters(overrides: Partial<DeliveryCounters> = {}): DeliveryCounters {
  return {
    attempted: 500,
    sent: 490,
    delivered: 480,
    bounced: 5,
    hardBounces: 3,
    softBounces: 2,
    failed: 5,
    replies: 30,
    uniqueRepliedLeads: 25,
    unsubscribes: 2,
    complaints: 0,
    complaintDataAvailable: false,
    ...overrides,
  };
}

function rates(overrides: Partial<DeliveryRates> = {}): DeliveryRates {
  return {
    deliveryRate: 98,
    bounceRate: 1,
    hardBounceRate: 0.6,
    failureRate: 1,
    replyRate: 6,
    unsubscribeRate: 0.4,
    complaintRate: null,
    ...overrides,
  };
}

function replies(overrides: Partial<ReplyAnalytics> = {}): ReplyAnalytics {
  return {
    totalReplies: 30,
    uniqueRepliedLeads: 25,
    breakdown: [],
    positive: 12,
    negative: 8,
    outOfOffice: 3,
    unsubscribes: 2,
    positiveRateOfReplies: leadRate(12, 25, 'replied leads'),
    positiveRateOfContacted: leadRate(12, 400, 'contacted leads'),
    responseTime: { averageHours: 12, medianHours: 8, sampleSize: 25 },
    ...overrides,
  };
}

function campaign(
  name: string,
  replyRate: number,
  attempted: number,
): CampaignAnalyticsRow {
  return {
    campaignId: name,
    name,
    status: 'ACTIVE',
    enrolledLeads: attempted,
    counters: counters({ attempted }),
    rates: rates({ replyRate }),
    positiveReplies: 5,
    meetings: 1,
    positiveReplyRate: buildRate(5, 20, 'replied leads'),
  };
}

function mailbox(emailAddress: string, bounceRate: number, attempted: number): MailboxAnalyticsRow {
  return {
    mailboxId: emailAddress,
    emailAddress,
    poolNames: [],
    healthScore: 80,
    counters: counters({ attempted }),
    rates: rates({ bounceRate }),
  };
}

function input(overrides: Partial<InsightInput> = {}): InsightInput {
  return {
    counters: counters(),
    rates: rates(),
    previousRates: rates(),
    funnel: buildFunnel({
      imported: 100,
      verified: 80,
      qualified: 60,
      contacted: 50,
      replied: 20,
      positiveReply: 10,
      meeting: 4,
    }),
    replies: replies(),
    campaigns: [],
    mailboxes: [],
    ...overrides,
  };
}

const ids = (insights: ReturnType<typeof buildInsights>) => insights.map((entry) => entry.id);

describe('buildInsights sample-size guards', () => {
  it('says nothing beyond a volume warning below the minimum send count', () => {
    const insights = buildInsights(
      input({
        counters: counters({ attempted: MIN_SENDS_FOR_RATE - 1 }),
        rates: rates({ bounceRate: 40, unsubscribeRate: 12 }),
      }),
    );

    expect(ids(insights)).toEqual(['low-volume']);
  });

  it('will not rank campaigns that have not sent enough to compare', () => {
    const insights = buildInsights(
      input({
        campaigns: [campaign('Strong', 12, 5), campaign('Weak', 1, 4)],
      }),
    );

    expect(ids(insights)).not.toContain('campaign-spread');
  });

  it('ranks campaigns once both clear the minimum send count', () => {
    const insights = buildInsights(
      input({
        campaigns: [campaign('Strong', 12, 200), campaign('Weak', 1, 200)],
      }),
    );

    expect(ids(insights)).toContain('campaign-spread');
    expect(insights.find((entry) => entry.id === 'campaign-spread')?.title).toContain('Strong');
  });

  it('ignores a low-volume mailbox with a bad bounce rate', () => {
    const insights = buildInsights(input({ mailboxes: [mailbox('new@example.com', 40, 3)] }));

    expect(ids(insights)).not.toContain('mailbox-bounces');
  });

  it('flags a high-volume mailbox bouncing above 5%', () => {
    const insights = buildInsights(input({ mailboxes: [mailbox('old@example.com', 9, 300)] }));

    expect(ids(insights)).toContain('mailbox-bounces');
  });

  it('withholds the positive-share warning until enough leads have replied', () => {
    const sparse = replies({
      uniqueRepliedLeads: 4,
      positive: 0,
      positiveRateOfReplies: buildRate(0, 4, 'replied leads'),
    });

    expect(ids(buildInsights(input({ replies: sparse })))).not.toContain('low-positive-share');
  });
});

describe('buildInsights rules', () => {
  it('escalates bounce rate from warning to critical', () => {
    expect(ids(buildInsights(input({ rates: rates({ bounceRate: 3 }) })))).toContain(
      'bounce-rate-warning',
    );
    expect(ids(buildInsights(input({ rates: rates({ bounceRate: 7 }) })))).toContain(
      'bounce-rate-critical',
    );
  });

  it('reports a meaningful drop in reply rate against the previous period', () => {
    const insights = buildInsights(
      input({ rates: rates({ replyRate: 3 }), previousRates: rates({ replyRate: 6 }) }),
    );

    expect(ids(insights)).toContain('reply-rate-down');
  });

  it('stays quiet about sub-point movement in reply rate', () => {
    const insights = buildInsights(
      input({ rates: rates({ replyRate: 6.2 }), previousRates: rates({ replyRate: 6 }) }),
    );

    expect(ids(insights)).not.toContain('reply-rate-down');
    expect(ids(insights)).not.toContain('reply-rate-up');
  });

  it('returns an all-clear rather than an empty list when nothing is wrong', () => {
    expect(ids(buildInsights(input()))).toEqual(['all-clear']);
  });
});
