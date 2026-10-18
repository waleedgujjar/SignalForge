import { describe, expect, it } from 'vitest';

import { campaignRowsToCsv, escapeCsv, mailboxRowsToCsv } from './export-service.js';
import { EMPTY_COUNTERS, calculateRates } from './metrics/formulas.js';
import type { MailboxHealthRow } from './stats-service.js';

function mailboxRow(overrides: Partial<MailboxHealthRow> = {}): MailboxHealthRow {
  const counters = { ...EMPTY_COUNTERS, attempted: 100, sent: 98, delivered: 98, bounced: 2 };
  return {
    mailboxId: 'mailbox-1',
    emailAddress: 'sales@example.com',
    status: 'ACTIVE',
    healthStatus: 'HEALTHY',
    healthScore: 92,
    tier: 'EXCELLENT',
    protectionLevel: 'NORMAL',
    protectionReason: null,
    warmupStatus: 'COMPLETED',
    counters,
    rates: calculateRates(counters),
    ...overrides,
  };
}

describe('escapeCsv', () => {
  it('quotes values containing separators or newlines', () => {
    expect(escapeCsv('a,b')).toBe('"a,b"');
    expect(escapeCsv('line\nbreak')).toBe('"line\nbreak"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
  });

  it('renders null and undefined as empty cells', () => {
    expect(escapeCsv(null)).toBe('');
    expect(escapeCsv(undefined)).toBe('');
  });
});

describe('mailboxRowsToCsv', () => {
  it('writes a header row followed by one row per mailbox', () => {
    const csv = mailboxRowsToCsv([mailboxRow(), mailboxRow({ emailAddress: 'hi@example.com' })]);
    const lines = csv.split('\n');

    expect(lines[0]).toContain('mailbox,status,healthScore');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('sales@example.com');
  });

  it('exports only aggregate metrics, never mailbox credentials', () => {
    const csv = mailboxRowsToCsv([mailboxRow()]).toLowerCase();
    for (const secret of ['password', 'smtp', 'token', 'secret', 'credential']) {
      expect(csv).not.toContain(secret);
    }
  });

  it('produces just the header when there is nothing to export', () => {
    expect(mailboxRowsToCsv([]).split('\n')).toHaveLength(1);
  });
});

describe('campaignRowsToCsv', () => {
  it('escapes campaign names containing commas', () => {
    const csv = campaignRowsToCsv([
      {
        name: 'Q1 Outbound, EMEA',
        status: 'ACTIVE',
        healthScore: 80,
        tier: 'HEALTHY',
        counters: {
          attempted: 50,
          sent: 50,
          delivered: 50,
          bounced: 0,
          failed: 0,
          uniqueRepliedLeads: 5,
          unsubscribes: 1,
        },
        rates: { bounceRate: 0, failureRate: 0, replyRate: 10, unsubscribeRate: 2 },
      },
    ]);

    expect(csv).toContain('"Q1 Outbound, EMEA"');
  });
});
