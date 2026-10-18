import { MIN_LEADS_FOR_RATE, MIN_SENDS_FOR_RATE } from './types.js';
import type {
  AnalyticsInsight,
  CampaignAnalyticsRow,
  DeliveryCounters,
  DeliveryRates,
  FunnelResult,
  MailboxAnalyticsRow,
  ReplyAnalytics,
} from './types.js';

export interface InsightInput {
  counters: DeliveryCounters;
  rates: DeliveryRates;
  previousRates: DeliveryRates;
  funnel: FunnelResult;
  replies: ReplyAnalytics;
  campaigns: CampaignAnalyticsRow[];
  mailboxes: MailboxAnalyticsRow[];
}

/// A campaign or mailbox needs at least this many sends before it can be called
/// a best or worst performer.
const MIN_SENDS_FOR_RANKING = MIN_SENDS_FOR_RATE;

/**
 * Rule-based observations shown above the dashboard.
 *
 * Every rule checks its sample size first: ranking two campaigns on three sends
 * each produces confident-looking nonsense. When there is not enough data the
 * rule stays silent rather than hedging in the copy.
 */
export function buildInsights(input: InsightInput): AnalyticsInsight[] {
  const insights: AnalyticsInsight[] = [];
  const { counters, rates, previousRates, replies, campaigns, mailboxes } = input;

  if (counters.attempted < MIN_SENDS_FOR_RATE) {
    insights.push({
      id: 'low-volume',
      severity: 'INFO',
      title: 'Not enough sending activity to draw conclusions',
      detail: `Only ${counters.attempted} send attempts in this period. Rates need at least ${MIN_SENDS_FOR_RATE} attempts to be meaningful.`,
      recommendation: 'Widen the date range or launch a campaign to start collecting data.',
    });
    return insights;
  }

  if (rates.bounceRate >= 5) {
    insights.push({
      id: 'bounce-rate-critical',
      severity: 'CRITICAL',
      title: `Bounce rate is ${rates.bounceRate}%`,
      detail:
        'Sustained bounce rates above 5% put sender reputation at risk and can get mailboxes throttled.',
      recommendation: 'Review list verification before enrolling leads, and check Deliverability for affected mailboxes.',
    });
  } else if (rates.bounceRate >= 2) {
    insights.push({
      id: 'bounce-rate-warning',
      severity: 'WARNING',
      title: `Bounce rate is ${rates.bounceRate}%`,
      detail: 'Bounce rate is above the 2% comfort threshold.',
      recommendation: 'Verify leads before enrollment to keep bounces down.',
    });
  }

  if (rates.replyRate > 0 && previousRates.replyRate > 0) {
    const change = Math.round((rates.replyRate - previousRates.replyRate) * 100) / 100;
    if (change <= -1) {
      insights.push({
        id: 'reply-rate-down',
        severity: 'WARNING',
        title: `Reply rate fell ${Math.abs(change)} points`,
        detail: `Reply rate moved from ${previousRates.replyRate}% to ${rates.replyRate}% versus the previous period.`,
        recommendation: 'Compare subject and step performance to find where engagement dropped.',
      });
    } else if (change >= 1) {
      insights.push({
        id: 'reply-rate-up',
        severity: 'INFO',
        title: `Reply rate rose ${change} points`,
        detail: `Reply rate moved from ${previousRates.replyRate}% to ${rates.replyRate}% versus the previous period.`,
        recommendation: null,
      });
    }
  }

  if (rates.unsubscribeRate >= 1) {
    insights.push({
      id: 'unsubscribe-rate',
      severity: 'WARNING',
      title: `Unsubscribe rate is ${rates.unsubscribeRate}%`,
      detail: 'A high unsubscribe rate usually means the targeting or the offer is off.',
      recommendation: 'Tighten targeting filters or revise the opening message.',
    });
  }

  const rankable = campaigns.filter((row) => row.counters.attempted >= MIN_SENDS_FOR_RANKING);
  if (rankable.length >= 2) {
    const sorted = [...rankable].sort((a, b) => b.rates.replyRate - a.rates.replyRate);
    const best = sorted[0]!;
    const worst = sorted[sorted.length - 1]!;
    if (best.rates.replyRate - worst.rates.replyRate >= 2) {
      insights.push({
        id: 'campaign-spread',
        severity: 'INFO',
        title: `"${best.name}" is your strongest campaign`,
        detail: `It replies at ${best.rates.replyRate}% versus ${worst.rates.replyRate}% for "${worst.name}".`,
        recommendation: `Consider reusing the messaging from "${best.name}" in weaker campaigns.`,
      });
    }
  }

  const weakMailboxes = mailboxes.filter(
    (row) => row.counters.attempted >= MIN_SENDS_FOR_RANKING && row.rates.bounceRate >= 5,
  );
  if (weakMailboxes.length > 0) {
    insights.push({
      id: 'mailbox-bounces',
      severity: 'WARNING',
      title: `${weakMailboxes.length} mailbox${weakMailboxes.length === 1 ? '' : 'es'} bouncing above 5%`,
      detail: weakMailboxes.map((row) => `${row.emailAddress} (${row.rates.bounceRate}%)`).join(', '),
      recommendation: 'Open Deliverability to check authentication and health for these mailboxes.',
    });
  }

  if (
    replies.uniqueRepliedLeads >= MIN_LEADS_FOR_RATE &&
    replies.positiveRateOfReplies.value !== null &&
    replies.positiveRateOfReplies.value < 20
  ) {
    insights.push({
      id: 'low-positive-share',
      severity: 'WARNING',
      title: `Only ${replies.positiveRateOfReplies.value}% of replies are positive`,
      detail: `${replies.positive} of ${replies.uniqueRepliedLeads} replying leads were classified as interested.`,
      recommendation: 'Revisit targeting — you are reaching people who reply but are not a fit.',
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: 'all-clear',
      severity: 'INFO',
      title: 'No issues detected',
      detail: 'Delivery, bounce, and reply rates are all within normal ranges for this period.',
      recommendation: null,
    });
  }

  return insights;
}
