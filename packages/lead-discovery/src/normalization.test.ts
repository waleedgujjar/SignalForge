import { describe, expect, it } from 'vitest';

import {
  hasUsableIdentity,
  hasImportableRowData,
  normalizeCompany,
  normalizeCountryCode,
  normalizeDomain,
  normalizeEmail,
  normalizeLead,
  normalizePhone,
  normalizeWebsite,
  resolveLeadName,
  getLeadDisplayName,
} from './normalization.js';

describe('normalizeDomain', () => {
  it('collapses the canonical URL variants to one domain', () => {
    const expected = 'example.com';
    expect(normalizeDomain('https://www.example.com/')).toBe(expected);
    expect(normalizeDomain('http://example.com')).toBe(expected);
    expect(normalizeDomain('https://example.com/?utm_source=x')).toBe(expected);
    expect(normalizeDomain('EXAMPLE.COM')).toBe(expected);
    expect(normalizeDomain('www.example.com/contact')).toBe(expected);
    expect(normalizeDomain('https://example.com:8443/x')).toBe(expected);
  });

  it('extracts the domain from an email address', () => {
    expect(normalizeDomain('hello@example.com')).toBe('example.com');
    expect(normalizeDomain('mailto:hello@example.com')).toBe('example.com');
  });

  it('keeps non-www subdomains distinct', () => {
    // Merging these would silently destroy a real, separate lead.
    expect(normalizeDomain('https://careers.example.com')).toBe('careers.example.com');
    expect(normalizeDomain('https://careers.example.com')).not.toBe(normalizeDomain('https://example.com'));
  });

  it('rejects values that cannot identify a company', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('http://192.168.1.1/')).toBeNull();
  });
});

describe('normalizeCompany', () => {
  it('matches the same business written different ways', () => {
    expect(normalizeCompany('ABC DENTAL LLC')).toBe('abc dental');
    expect(normalizeCompany('ABC Dental')).toBe('abc dental');
    expect(normalizeCompany('  abc   dental,  Inc. ')).toBe('abc dental');
  });

  it('strips stacked legal suffixes', () => {
    expect(normalizeCompany('ABC Dental Group LLC')).toBe('abc dental');
  });

  it('expands ampersands so "A & B" and "A and B" agree', () => {
    expect(normalizeCompany('Smith & Sons')).toBe(normalizeCompany('Smith and Sons'));
  });

  it('returns null for empty input', () => {
    expect(normalizeCompany('')).toBeNull();
    expect(normalizeCompany(null)).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Hello@Example.COM ')).toBe('hello@example.com');
  });

  it('pulls the address out of a display-name wrapper', () => {
    expect(normalizeEmail('Jane Doe <jane@example.com>')).toBe('jane@example.com');
    expect(normalizeEmail('mailto:jane@example.com')).toBe('jane@example.com');
  });

  it('rejects malformed values', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('@example.com')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('produces one canonical form for the same US number', () => {
    const expected = '+15125550142';
    expect(normalizePhone('(512) 555-0142', 'US')).toBe(expected);
    expect(normalizePhone('512-555-0142', 'US')).toBe(expected);
    expect(normalizePhone('+1 512 555 0142', 'US')).toBe(expected);
    expect(normalizePhone('1-512-555-0142', 'US')).toBe(expected);
  });

  it('drops extensions so they do not split a match', () => {
    expect(normalizePhone('512-555-0142 ext. 22', 'US')).toBe('+15125550142');
  });

  it('rejects values that are not phone numbers', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('normalizeWebsite', () => {
  it('removes tracking parameters but keeps meaningful paths', () => {
    expect(normalizeWebsite('https://example.com/pricing?utm_source=x&plan=pro')).toBe(
      'https://example.com/pricing?plan=pro',
    );
  });

  it('upgrades scheme-less input and drops the bare root path', () => {
    expect(normalizeWebsite('www.example.com')).toBe('https://example.com');
  });

  it('rejects non-http schemes', () => {
    expect(normalizeWebsite('javascript:alert(1)')).toBeNull();
  });
});

describe('normalizeCountryCode', () => {
  it('maps common aliases to ISO codes', () => {
    expect(normalizeCountryCode('USA')).toBe('US');
    expect(normalizeCountryCode('United States')).toBe('US');
    expect(normalizeCountryCode('uk')).toBe('GB');
    expect(normalizeCountryCode('ca')).toBe('CA');
  });

  it('returns null for unrecognised values', () => {
    expect(normalizeCountryCode('Neverland')).toBeNull();
  });
});

describe('normalizeLead', () => {
  it('derives full name and domain, and preserves the raw values', () => {
    const result = normalizeLead({
      company: 'ABC DENTAL LLC',
      firstName: ' Jane ',
      lastName: 'Doe',
      email: 'Jane@Example.com',
      phone: '(512) 555-0142',
      website: 'https://www.example.com/',
      countryCode: 'USA',
      city: 'Austin',
    });

    expect(result.fullName).toBe('Jane Doe');
    expect(result.normalizedCompany).toBe('abc dental');
    expect(result.normalizedEmail).toBe('jane@example.com');
    expect(result.normalizedDomain).toBe('example.com');
    expect(result.normalizedPhone).toBe('+15125550142');
    expect(result.countryCode).toBe('US');
  });

  it('recovers a domain from the email when no website is given', () => {
    const result = normalizeLead({ company: 'ACME', email: 'info@acme.io' });
    expect(result.normalizedDomain).toBe('acme.io');
  });

  it('flags records with no usable identity', () => {
    expect(hasUsableIdentity(normalizeLead({ phone: '512-555-0142' }))).toBe(false);
    expect(hasUsableIdentity(normalizeLead({ company: 'ACME' }))).toBe(true);
    expect(hasUsableIdentity(normalizeLead({ email: 'a@b.com' }))).toBe(true);
  });

  it('accepts import rows with phone or name even without company/email/domain', () => {
    expect(hasImportableRowData(normalizeLead({ phone: '512-555-0142' }))).toBe(true);
    expect(hasImportableRowData(normalizeLead({ fullName: 'Jane Doe' }))).toBe(true);
    expect(hasImportableRowData(normalizeLead({}))).toBe(false);
  });
});

describe('resolveLeadName', () => {
  it('uses owner name when present', () => {
    const result = resolveLeadName('John Smith', 'ABC HVAC');
    expect(result.fullName).toBe('John Smith');
    expect(result.firstName).toBe('John');
    expect(result.lastName).toBe('Smith');
  });

  it('uses firstName + lastName before company fallback', () => {
    const result = resolveLeadName(null, 'ABC HVAC', { firstName: 'John', lastName: 'Smith' });
    expect(result.fullName).toBe('John Smith');
    expect(result.firstName).toBe('John');
    expect(result.lastName).toBe('Smith');
  });

  it('falls back to company when owner is missing', () => {
    const result = resolveLeadName(null, 'ABC HVAC');
    expect(result.fullName).toBe('ABC HVAC');
  });

  it('ignores invalid owner names', () => {
    const result = resolveLeadName('N/A', 'ABC HVAC');
    expect(result.fullName).toBe('ABC HVAC');
  });
});

describe('getLeadDisplayName', () => {
  it('prefers fullName over first+last and company', () => {
    expect(getLeadDisplayName({ fullName: 'John Smith', firstName: 'Jane', company: 'ACME' })).toBe('John Smith');
  });

  it('uses first+last when fullName is missing', () => {
    expect(getLeadDisplayName({ firstName: 'John', lastName: 'Smith', company: 'ACME' })).toBe('John Smith');
  });

  it('falls back to company', () => {
    expect(getLeadDisplayName({ company: 'ACME Corp' })).toBe('ACME Corp');
  });
});

describe('File E mixed formatting', () => {
  it('normalizes whitespace, casing, and website variants', () => {
    expect(normalizeEmail('  JOHN@EXAMPLE.COM  ')).toBe('john@example.com');
    expect(normalizePhone('(713) 555-1234', 'US')).toBe('+17135551234');
    expect(normalizeWebsite('www.example.com/')).toBe('https://example.com');
  });
});
