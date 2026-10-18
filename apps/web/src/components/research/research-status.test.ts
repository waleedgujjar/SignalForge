import { describe, expect, it, vi } from 'vitest';

import {
  CONFIDENCE_VARIANTS,
  RESEARCH_STATUSES,
  RESEARCH_STATUS_LABELS,
  RESEARCH_STATUS_STYLES,
  VERIFICATION_VARIANTS,
  formatConfidence,
  formatProvenance,
  humanizeField,
  invalidateResearchQueries,
  isLinkedInCompanyUrl,
  isLinkedInPersonUrl,
  isResearchActive,
  researchStatusLabel,
  splitLinkedInUrl,
  toVerificationState,
} from './research-status';

describe('research-status labels', () => {
  it('has a label and a style for every display status', () => {
    for (const status of RESEARCH_STATUSES) {
      expect(RESEARCH_STATUS_LABELS[status]).toBeTruthy();
      expect(RESEARCH_STATUS_STYLES[status]).toBeTruthy();
    }
    expect(Object.keys(RESEARCH_STATUS_LABELS).sort()).toEqual([...RESEARCH_STATUSES].sort());
  });

  it('maps known statuses and passes unknown values through', () => {
    expect(researchStatusLabel('MANUAL_REVIEW')).toBe('Manual Review');
    expect(researchStatusLabel('PENDING')).toBe('Suggested');
    expect(researchStatusLabel('NOT_RESEARCHED')).toBe('Not Researched');
    expect(researchStatusLabel(undefined)).toBe('Not Researched');
    expect(researchStatusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('treats only QUEUED and IN_PROGRESS as active', () => {
    expect(isResearchActive('QUEUED')).toBe(true);
    expect(isResearchActive('IN_PROGRESS')).toBe(true);
    expect(isResearchActive('COMPLETED')).toBe(false);
    expect(isResearchActive(null)).toBe(false);
  });
});

describe('verification and confidence variants', () => {
  it('uses success / warning / outline for VERIFIED / INFERRED / UNKNOWN', () => {
    expect(VERIFICATION_VARIANTS).toEqual({ VERIFIED: 'success', INFERRED: 'warning', UNKNOWN: 'outline' });
  });

  it('never upgrades an unrecognised label', () => {
    expect(toVerificationState('VERIFIED')).toBe('VERIFIED');
    expect(toVerificationState('verified')).toBe('UNKNOWN');
    expect(toVerificationState(null)).toBe('UNKNOWN');
    expect(toVerificationState('TRUE')).toBe('UNKNOWN');
  });

  it('has a variant for every research confidence', () => {
    expect(Object.keys(CONFIDENCE_VARIANTS).sort()).toEqual(['HIGH', 'LOW', 'MEDIUM', 'UNKNOWN']);
  });
});

describe('formatConfidence', () => {
  it('formats 0..1 ratios as percentages', () => {
    expect(formatConfidence(0.824)).toBe('82%');
    expect(formatConfidence(1)).toBe('100%');
    expect(formatConfidence(0)).toBe('0%');
  });

  it('accepts already-percent values', () => {
    expect(formatConfidence(82)).toBe('82%');
    expect(formatConfidence(140)).toBe('100%');
  });

  it('renders a dash for missing or non-finite values', () => {
    expect(formatConfidence(NaN)).toBe('—');
    expect(formatConfidence(null)).toBe('—');
    expect(formatConfidence(undefined)).toBe('—');
    expect(formatConfidence(Infinity)).toBe('—');
  });
});

describe('humanizeField', () => {
  it('splits dotted camelCase paths', () => {
    expect(humanizeField('company.employeeRange')).toBe('Company · Employee range');
    expect(humanizeField('person.fullName')).toBe('Person · Full name');
    expect(humanizeField('signals.decisionMaker')).toBe('Signals · Decision maker');
  });

  it('handles single segments and snake_case', () => {
    expect(humanizeField('industry')).toBe('Industry');
    expect(humanizeField('employee_range')).toBe('Employee range');
  });
});

describe('formatProvenance', () => {
  it('includes source, provider and ISO date', () => {
    expect(
      formatProvenance({ source: 'LINKEDIN_PUBLIC', provider: 'public', retrievedAt: '2026-09-16T10:20:30.000Z' }),
    ).toBe('LinkedIn (public page) · public · 2026-09-16');
  });

  it('omits the provider and unparseable dates', () => {
    expect(formatProvenance({ source: 'MANUAL', provider: null, retrievedAt: null })).toBe('Manual (researcher)');
    expect(formatProvenance({ source: 'MANUAL', provider: null, retrievedAt: 'not-a-date' })).toBe('Manual (researcher)');
  });

  it('humanizes unknown sources', () => {
    expect(formatProvenance({ source: 'SOME_NEW_SOURCE' })).toBe('Some new source');
  });
});

describe('LinkedIn URL helpers', () => {
  it('accepts person URLs in every common form', () => {
    expect(isLinkedInPersonUrl('https://www.linkedin.com/in/jane-doe')).toBe(true);
    expect(isLinkedInPersonUrl('https://www.linkedin.com/in/jane-doe/')).toBe(true);
    expect(isLinkedInPersonUrl('https://www.linkedin.com/in/jane-doe?trk=abc#top')).toBe(true);
    expect(isLinkedInPersonUrl('HTTPS://WWW.LINKEDIN.COM/in/Jane-Doe')).toBe(true);
    expect(isLinkedInPersonUrl('linkedin.com/in/x')).toBe(true);
    expect(isLinkedInPersonUrl('https://uk.linkedin.com/pub/jane-doe/1/2/3')).toBe(true);
  });

  it('accepts company, showcase and school URLs as company targets', () => {
    expect(isLinkedInCompanyUrl('https://www.linkedin.com/company/acme')).toBe(true);
    expect(isLinkedInCompanyUrl('https://www.linkedin.com/company/acme/')).toBe(true);
    expect(isLinkedInCompanyUrl('https://www.linkedin.com/school/mit/')).toBe(true);
    expect(isLinkedInCompanyUrl('https://www.linkedin.com/showcase/acme-cloud')).toBe(true);
    expect(isLinkedInCompanyUrl('https://www.linkedin.com/in/jane-doe')).toBe(false);
    expect(isLinkedInPersonUrl('https://www.linkedin.com/company/acme')).toBe(false);
  });

  it('rejects non-LinkedIn hosts and unsupported paths', () => {
    expect(isLinkedInPersonUrl('https://example.com/in/x')).toBe(false);
    expect(isLinkedInPersonUrl('https://linkedin.com.evil.com/in/x')).toBe(false);
    expect(isLinkedInPersonUrl('https://notlinkedin.com/in/x')).toBe(false);
    expect(isLinkedInPersonUrl('https://lnkd.in/abc')).toBe(false);
    expect(isLinkedInCompanyUrl('https://www.linkedin.com/feed')).toBe(false);
    expect(isLinkedInCompanyUrl('https://www.linkedin.com/feed/')).toBe(false);
    expect(isLinkedInPersonUrl('https://www.linkedin.com/in/')).toBe(false);
    expect(isLinkedInPersonUrl('ftp://www.linkedin.com/in/x')).toBe(false);
    expect(isLinkedInPersonUrl('javascript:alert(1)')).toBe(false);
    expect(isLinkedInPersonUrl('https://user:pw@www.linkedin.com/in/x')).toBe(false);
    expect(isLinkedInPersonUrl('')).toBe(false);
    expect(isLinkedInPersonUrl(`https://www.linkedin.com/in/${'a'.repeat(600)}`)).toBe(false);
  });

  it('normalizes host, casing, query, fragment and trailing slash', () => {
    const parts = splitLinkedInUrl('uk.linkedin.com/in/Jane-Doe/?trk=x#top');
    expect(parts).not.toBeNull();
    expect(parts?.kind).toBe('PERSON');
    expect(parts?.normalizedUrl).toBe('https://www.linkedin.com/in/jane-doe');
    expect(parts?.sourceUrl).toBe('uk.linkedin.com/in/Jane-Doe/?trk=x#top');

    expect(splitLinkedInUrl('https://www.linkedin.com/pub/jane-doe/1/2/3')?.normalizedUrl).toBe(
      'https://www.linkedin.com/in/jane-doe',
    );
    expect(splitLinkedInUrl('https://www.linkedin.com/jobs/view/12345/')?.kind).toBe('JOB');
    expect(splitLinkedInUrl('https://www.linkedin.com/jobs/12345')).toBeNull();
  });
});

describe('invalidateResearchQueries', () => {
  it('invalidates queue/stats always and lead-scoped keys when a lead id is given', () => {
    const invalidateQueries = vi.fn();
    invalidateResearchQueries({ invalidateQueries }, 'lead-1');
    const keys = invalidateQueries.mock.calls.map((call) => JSON.stringify(call[0].queryKey));
    expect(keys).toContain(JSON.stringify(['research-queue']));
    expect(keys).toContain(JSON.stringify(['research-stats']));
    expect(keys).toContain(JSON.stringify(['lead-research', 'lead-1']));
    expect(keys).toContain(JSON.stringify(['lead-research-history', 'lead-1']));
    expect(keys).toContain(JSON.stringify(['research-suggestions', 'lead-1']));
    expect(keys).not.toContain(JSON.stringify(['lead', 'lead-1']));
  });

  it('also refreshes the lead and enrichment after verification', () => {
    const invalidateQueries = vi.fn();
    invalidateResearchQueries({ invalidateQueries }, 'lead-1', { includeLead: true });
    const keys = invalidateQueries.mock.calls.map((call) => JSON.stringify(call[0].queryKey));
    expect(keys).toContain(JSON.stringify(['lead', 'lead-1']));
    expect(keys).toContain(JSON.stringify(['lead-enrichment', 'lead-1']));
  });

  it('skips lead-scoped keys without a lead id', () => {
    const invalidateQueries = vi.fn();
    invalidateResearchQueries({ invalidateQueries }, null);
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});
