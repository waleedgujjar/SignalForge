import { describe, expect, it } from 'vitest';

import { dimensionRowsToCsv, funnelToCsv, timelineToCsv } from './export-service.js';
import { buildFunnel } from './funnel-service.js';
import { buildRate, leadRate } from './metrics/formulas.js';
import { INSUFFICIENT_DATA_NOTE } from './types.js';
import type { DimensionRow, TimelinePoint } from './types.js';

function dimensionRow(overrides: Partial<DimensionRow> = {}): DimensionRow {
  return {
    key: 'saas',
    label: 'SaaS',
    leads: 40,
    contacted: 30,
    replies: 6,
    positiveReplies: 3,
    meetings: 1,
    replyRate: leadRate(6, 30, 'contacted leads'),
    positiveReplyRate: leadRate(3, 6, 'replied leads'),
    ...overrides,
  };
}

describe('dimensionRowsToCsv', () => {
  it('writes a header row followed by one row per dimension value', () => {
    const lines = dimensionRowsToCsv('Industry', [dimensionRow()]).split('\n');

    expect(lines[0]).toBe(
      'Industry,leads,contacted,replies,positiveReplies,meetings,replyRatePercent,positiveReplyRatePercent',
    );
    expect(lines[1]).toBe('SaaS,40,30,6,3,1,20,Insufficient data');
    expect(lines).toHaveLength(2);
  });

  it('says "Insufficient data" instead of leaving a withheld rate blank', () => {
    const csv = dimensionRowsToCsv('Industry', [
      dimensionRow({ replyRate: buildRate(0, 2, 'contacted leads', { minimumSample: 10 }) }),
    ]);

    expect(csv).toContain(INSUFFICIENT_DATA_NOTE);
  });

  it('quotes values containing commas so columns stay aligned', () => {
    const csv = dimensionRowsToCsv('Industry', [
      dimensionRow({ label: 'Software, SaaS & Cloud' }),
    ]);

    expect(csv).toContain('"Software, SaaS & Cloud"');
  });

  it('emits only a header when there is nothing to export', () => {
    expect(dimensionRowsToCsv('Industry', []).split('\n')).toHaveLength(1);
  });
});

describe('funnelToCsv', () => {
  it('exports one row per stage with both conversion bases', () => {
    const csv = funnelToCsv(
      buildFunnel({
        imported: 100,
        verified: 80,
        qualified: 60,
        contacted: 50,
        replied: 20,
        positiveReply: 10,
        meeting: 4,
      }),
    );
    const lines = csv.split('\n');

    expect(lines).toHaveLength(8);
    expect(lines[1]).toBe('Imported,100,,,0');
    expect(lines[2]).toBe('Verified,80,80,80,20');
  });
});

describe('timelineToCsv', () => {
  it('preserves the daily buckets in order', () => {
    const points: TimelinePoint[] = [
      {
        date: '2026-03-01',
        sent: 10,
        delivered: 9,
        bounced: 1,
        failed: 0,
        replies: 2,
        unsubscribes: 0,
        deliveryRate: 90,
        bounceRate: 10,
        replyRate: 20,
      },
    ];

    const lines = timelineToCsv(points).split('\n');

    expect(lines[0]?.startsWith('date,sent,delivered')).toBe(true);
    expect(lines[1]).toBe('2026-03-01,10,9,1,0,2,0,90,10,20');
  });
});
