import type { MailboxHealthRow } from './stats-service.js';

/**
 * CSV serialization for deliverability metrics.
 *
 * Only aggregate metrics are exported — no SMTP credentials, tokens, or
 * connection details ever reach an export.
 */

export function escapeCsv(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

const MAILBOX_HEADERS = [
  'mailbox',
  'status',
  'healthScore',
  'tier',
  'protectionLevel',
  'attempted',
  'sent',
  'delivered',
  'bounced',
  'hardBounces',
  'softBounces',
  'failed',
  'uniqueReplies',
  'unsubscribes',
  'bounceRatePercent',
  'failureRatePercent',
  'replyRatePercent',
  'unsubscribeRatePercent',
];

export function mailboxRowsToCsv(rows: MailboxHealthRow[]): string {
  const lines = [MAILBOX_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.emailAddress,
        row.status,
        row.healthScore,
        row.tier,
        row.protectionLevel,
        row.counters.attempted,
        row.counters.sent,
        row.counters.delivered,
        row.counters.bounced,
        row.counters.hardBounces,
        row.counters.softBounces,
        row.counters.failed,
        row.counters.uniqueRepliedLeads,
        row.counters.unsubscribes,
        row.rates.bounceRate,
        row.rates.failureRate,
        row.rates.replyRate,
        row.rates.unsubscribeRate,
      ]
        .map(escapeCsv)
        .join(','),
    );
  }
  return lines.join('\n');
}

const CAMPAIGN_HEADERS = [
  'campaign',
  'status',
  'healthScore',
  'tier',
  'attempted',
  'sent',
  'delivered',
  'bounced',
  'failed',
  'uniqueReplies',
  'unsubscribes',
  'bounceRatePercent',
  'failureRatePercent',
  'replyRatePercent',
  'unsubscribeRatePercent',
];

export interface CampaignExportRow {
  name: string;
  status: string;
  healthScore: number;
  tier: string;
  counters: {
    attempted: number;
    sent: number;
    delivered: number;
    bounced: number;
    failed: number;
    uniqueRepliedLeads: number;
    unsubscribes: number;
  };
  rates: {
    bounceRate: number;
    failureRate: number;
    replyRate: number;
    unsubscribeRate: number;
  };
}

export function campaignRowsToCsv(rows: CampaignExportRow[]): string {
  const lines = [CAMPAIGN_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.name,
        row.status,
        row.healthScore,
        row.tier,
        row.counters.attempted,
        row.counters.sent,
        row.counters.delivered,
        row.counters.bounced,
        row.counters.failed,
        row.counters.uniqueRepliedLeads,
        row.counters.unsubscribes,
        row.rates.bounceRate,
        row.rates.failureRate,
        row.rates.replyRate,
        row.rates.unsubscribeRate,
      ]
        .map(escapeCsv)
        .join(','),
    );
  }
  return lines.join('\n');
}
