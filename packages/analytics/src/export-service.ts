import { escapeCsv } from '@signalforge/deliverability';
import { INSUFFICIENT_DATA_NOTE } from './types.js';
import type {
  CampaignAnalyticsRow,
  DimensionRow,
  DiscoveryAnalytics,
  FunnelResult,
  MailboxAnalyticsRow,
  RateValue,
  SequenceStepRow,
  TimelinePoint,
} from './types.js';

/**
 * CSV serialization for the analytics tables.
 *
 * Only aggregated metrics are exported. A rate that failed its sample-size
 * check is written as "Insufficient data" rather than as an empty cell, so the
 * export says the same thing the dashboard does.
 */

export type AnalyticsExportType =
  | 'campaigns'
  | 'mailboxes'
  | 'sequences'
  | 'funnel'
  | 'timeline'
  | 'sources'
  | 'industries'
  | 'geography'
  | 'job-titles'
  | 'discovery';

function rateCell(rate: RateValue): string {
  return rate.value === null ? INSUFFICIENT_DATA_NOTE : String(rate.value);
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n');
}

export function campaignRowsToCsv(rows: CampaignAnalyticsRow[]): string {
  return toCsv(
    [
      'campaign',
      'status',
      'enrolledLeads',
      'sent',
      'delivered',
      'bounced',
      'failed',
      'uniqueReplies',
      'positiveReplies',
      'meetings',
      'unsubscribes',
      'deliveryRatePercent',
      'bounceRatePercent',
      'replyRatePercent',
      'unsubscribeRatePercent',
    ],
    rows.map((row) => [
      row.name,
      row.status,
      row.enrolledLeads,
      row.counters.sent,
      row.counters.delivered,
      row.counters.bounced,
      row.counters.failed,
      row.counters.uniqueRepliedLeads,
      row.positiveReplies,
      row.meetings,
      row.counters.unsubscribes,
      row.rates.deliveryRate,
      row.rates.bounceRate,
      row.rates.replyRate,
      row.rates.unsubscribeRate,
    ]),
  );
}

export function mailboxRowsToCsv(rows: MailboxAnalyticsRow[]): string {
  return toCsv(
    [
      'mailbox',
      'pools',
      'healthScore',
      'sent',
      'delivered',
      'bounced',
      'failed',
      'uniqueReplies',
      'unsubscribes',
      'deliveryRatePercent',
      'bounceRatePercent',
      'replyRatePercent',
    ],
    rows.map((row) => [
      row.emailAddress,
      row.poolNames.join(' | '),
      row.healthScore,
      row.counters.sent,
      row.counters.delivered,
      row.counters.bounced,
      row.counters.failed,
      row.counters.uniqueRepliedLeads,
      row.counters.unsubscribes,
      row.rates.deliveryRate,
      row.rates.bounceRate,
      row.rates.replyRate,
    ]),
  );
}

export function sequenceRowsToCsv(rows: SequenceStepRow[]): string {
  return toCsv(
    ['campaign', 'step', 'subject', 'sent', 'failed', 'replies', 'unsubscribes', 'replyRatePercent'],
    rows.map((row) => [
      row.campaignName,
      row.order,
      row.subject,
      row.counters.sent,
      row.counters.failed,
      row.counters.replies,
      row.counters.unsubscribes,
      row.rates.replyRate,
    ]),
  );
}

export function funnelToCsv(funnel: FunnelResult): string {
  return toCsv(
    ['stage', 'count', 'conversionFromPreviousPercent', 'conversionFromTopPercent', 'dropOff'],
    funnel.steps.map((step) => [
      step.label,
      step.count,
      step.conversionFromPrevious ? rateCell(step.conversionFromPrevious) : '',
      step.conversionFromTop ? rateCell(step.conversionFromTop) : '',
      step.dropOff,
    ]),
  );
}

export function timelineToCsv(points: TimelinePoint[]): string {
  return toCsv(
    [
      'date',
      'sent',
      'delivered',
      'bounced',
      'failed',
      'replies',
      'unsubscribes',
      'deliveryRatePercent',
      'bounceRatePercent',
      'replyRatePercent',
    ],
    points.map((point) => [
      point.date,
      point.sent,
      point.delivered,
      point.bounced,
      point.failed,
      point.replies,
      point.unsubscribes,
      point.deliveryRate,
      point.bounceRate,
      point.replyRate,
    ]),
  );
}

export function dimensionRowsToCsv(label: string, rows: DimensionRow[]): string {
  return toCsv(
    [
      label,
      'leads',
      'contacted',
      'replies',
      'positiveReplies',
      'meetings',
      'replyRatePercent',
      'positiveReplyRatePercent',
    ],
    rows.map((row) => [
      row.label,
      row.leads,
      row.contacted,
      row.replies,
      row.positiveReplies,
      row.meetings,
      rateCell(row.replyRate),
      rateCell(row.positiveReplyRate),
    ]),
  );
}

export function discoveryRowsToCsv(discovery: DiscoveryAnalytics): string {
  return toCsv(
    ['source', 'jobs', 'discovered', 'promoted', 'qualified'],
    discovery.bySource.map((row) => [row.source, row.jobs, row.discovered, row.promoted, row.qualified]),
  );
}

export { escapeCsv };
