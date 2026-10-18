import { describe, expect, it } from 'vitest';

import { createDedupIndex, dedupeBatch, findDuplicate, similarity, toDedupEntry } from './dedup.js';
import { normalizeLead } from './normalization.js';

function lead(input: Parameters<typeof normalizeLead>[0]) {
  return normalizeLead(input);
}

describe('similarity', () => {
  it('scores identical strings 1 and unrelated strings low', () => {
    expect(similarity('abc dental', 'abc dental')).toBe(1);
    expect(similarity('abc dental', 'zzz plumbing')).toBeLessThan(0.5);
  });
});

describe('findDuplicate tiers', () => {
  it('tier 1 — matches on exact email above everything else', () => {
    const index = createDedupIndex([
      toDedupEntry(lead({ company: 'Totally Different', email: 'jane@example.com' }), 'existing-1'),
    ]);
    const match = findDuplicate(
      toDedupEntry(lead({ company: 'ACME', email: 'JANE@example.com' }), 'new'),
      index,
    );
    expect(match?.tier).toBe('EMAIL');
    expect(match?.id).toBe('existing-1');
  });

  it('tier 2 — matches on normalized domain across URL variants', () => {
    const index = createDedupIndex([
      toDedupEntry(lead({ company: 'ACME', website: 'https://www.acme.com/' }), 'existing-1'),
    ]);
    const match = findDuplicate(
      toDedupEntry(lead({ company: 'Acme Corporation', website: 'http://acme.com?utm_source=x' }), 'new'),
      index,
    );
    expect(match?.tier).toBe('DOMAIN');
  });

  it('tier 3 — matches on phone when neither record has an email', () => {
    const index = createDedupIndex([
      toDedupEntry(lead({ company: 'Smile Dental', phone: '+1 512 555 0142', countryCode: 'US' }), 'existing-1'),
    ]);
    const match = findDuplicate(
      toDedupEntry(lead({ company: 'Smile Dental Care', phone: '(512) 555-0142', countryCode: 'US' }), 'new'),
      index,
    );
    expect(match?.tier).toBe('PHONE');
  });

  it('tier 4 — matches the same source record on a re-run', () => {
    const first = lead({ company: 'ACME', sourceId: 'place-123' });
    const index = createDedupIndex([toDedupEntry(first, 'existing-1', 'GOOGLE_PLACES')]);
    const match = findDuplicate(toDedupEntry(first, 'new', 'GOOGLE_PLACES'), index);
    expect(match?.tier).toBe('SOURCE_ID');
  });

  it('tier 5 — matches company plus location', () => {
    const index = createDedupIndex([
      toDedupEntry(lead({ company: 'Bright Smiles LLC', city: 'Austin', countryCode: 'US' }), 'existing-1'),
    ]);
    const match = findDuplicate(
      toDedupEntry(lead({ company: 'Bright Smiles', city: 'Austin', countryCode: 'US' }), 'new'),
      index,
    );
    expect(match?.tier).toBe('COMPANY_LOCATION');
  });

  it('tier 5 — does NOT match the same company name in a different city', () => {
    const index = createDedupIndex([
      toDedupEntry(lead({ company: 'Bright Smiles', city: 'Austin', countryCode: 'US' }), 'existing-1'),
    ]);
    const match = findDuplicate(
      toDedupEntry(lead({ company: 'Bright Smiles', city: 'Dallas', countryCode: 'US' }), 'new'),
      index,
    );
    expect(match).toBeNull();
  });

  it('tier 6 — fuzzy-matches a near-identical name in the same city', () => {
    const index = createDedupIndex([
      toDedupEntry(lead({ company: 'Riverside Dental Clinic', city: 'Austin', countryCode: 'US' }), 'existing-1'),
    ]);
    const match = findDuplicate(
      toDedupEntry(lead({ company: 'Riverside Dental Clinics', city: 'Austin', countryCode: 'US' }), 'new'),
      index,
    );
    expect(match?.tier).toBe('FUZZY_COMPANY');
  });

  it('tier 6 — refuses to merge similar names with different domains', () => {
    // Two real, distinct agencies. Merging them would delete one.
    const index = createDedupIndex([
      toDedupEntry(
        lead({ company: 'Northstar Marketing', website: 'northstar-marketing.com', city: 'Austin' }),
        'existing-1',
      ),
    ]);
    const match = findDuplicate(
      toDedupEntry(
        lead({ company: 'Northstar Marketing', website: 'northstarmarketing.io', city: 'Austin' }),
        'new',
      ),
      index,
    );
    // Different domains ⇒ different businesses, so no fuzzy merge.
    expect(match).toBeNull();
  });

  it('tier 6 — will not fuzzy-match very short names', () => {
    const index = createDedupIndex([toDedupEntry(lead({ company: 'ACME', city: 'Austin' }), 'existing-1')]);
    const match = findDuplicate(toDedupEntry(lead({ company: 'ACNE', city: 'Austin' }), 'new'), index);
    expect(match).toBeNull();
  });

  it('returns null for a genuinely new lead', () => {
    const index = createDedupIndex([toDedupEntry(lead({ company: 'ACME', email: 'a@acme.com' }), 'existing-1')]);
    const match = findDuplicate(
      toDedupEntry(lead({ company: 'Globex', email: 'b@globex.com' }), 'new'),
      index,
    );
    expect(match).toBeNull();
  });
});

describe('dedupeBatch', () => {
  it('collapses the same business from three sources into one lead', () => {
    const batch = [
      lead({ company: 'ABC Dental', website: 'https://www.abcdental.com', city: 'Austin', countryCode: 'US' }),
      lead({ company: 'ABC DENTAL LLC', website: 'http://abcdental.com/', city: 'Austin', countryCode: 'US' }),
      lead({ company: 'ABC Dental', email: 'info@abcdental.com', city: 'Austin', countryCode: 'US' }),
    ];

    const result = dedupeBatch(batch, []);
    expect(result.unique).toHaveLength(1);
    expect(result.duplicates).toHaveLength(2);
    expect(result.duplicates.every((d) => d.match.id === 'batch:0')).toBe(true);
  });

  it('detects a duplicate against a lead already in the workspace', () => {
    const existing = [toDedupEntry(lead({ company: 'ACME', email: 'jane@acme.com' }), 'lead-1')];
    const result = dedupeBatch([lead({ company: 'ACME Inc', email: 'jane@acme.com' })], existing);

    expect(result.unique).toHaveLength(0);
    expect(result.duplicates[0]?.match.id).toBe('lead-1');
    expect(result.duplicates[0]?.match.tier).toBe('EMAIL');
  });

  it('keeps genuinely distinct businesses separate', () => {
    const result = dedupeBatch(
      [
        lead({ company: 'ACME', email: 'a@acme.com' }),
        lead({ company: 'Globex', email: 'b@globex.com' }),
        lead({ company: 'Initech', email: 'c@initech.com' }),
      ],
      [],
    );
    expect(result.unique).toHaveLength(3);
    expect(result.duplicates).toHaveLength(0);
  });

  it('is idempotent — re-running the same batch finds every row duplicate', () => {
    const batch = [lead({ company: 'ACME', email: 'a@acme.com', sourceId: 'p1' })];
    const first = dedupeBatch(batch, []);
    expect(first.unique).toHaveLength(1);

    const existing = first.unique.map((u) => toDedupEntry(u.lead, 'lead-1', 'CSV'));
    const second = dedupeBatch(batch, existing, 'CSV');
    expect(second.unique).toHaveLength(0);
    expect(second.duplicates).toHaveLength(1);
  });

  it('does not merge two rows that share only a missing field', () => {
    const result = dedupeBatch(
      [lead({ company: 'Alpha Consulting Partners' }), lead({ company: 'Beta Industrial Supplies' })],
      [],
    );
    expect(result.unique).toHaveLength(2);
  });
});
