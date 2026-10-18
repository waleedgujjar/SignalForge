import { describe, expect, it } from 'vitest';
import {
  normalizeHeader,
  detectColumnMappings,
  buildMappingsRecord,
  isCustomField,
  LEAD_FIELDS,
  CUSTOM_FIELD_TARGETS,
} from './column-detector.js';

describe('normalizeHeader', () => {
  it('lowercases and trims', () => {
    expect(normalizeHeader('  EMAIL  ')).toBe('email');
  });

  it('splits camelCase', () => {
    expect(normalizeHeader('CompanyName')).toBe('company name');
    expect(normalizeHeader('firstName')).toBe('first name');
  });

  it('replaces separators with spaces', () => {
    expect(normalizeHeader('phone-no')).toBe('phone no');
    expect(normalizeHeader('phone_number')).toBe('phone number');
    expect(normalizeHeader('Owner/CEO')).toBe('owner ceo');
  });

  it('strips non-alphanumeric except # and spaces', () => {
    expect(normalizeHeader('Phone #')).toBe('phone #');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeHeader('first   name')).toBe('first name');
  });
});

describe('detectColumnMappings', () => {
  it('detects standard column headers', () => {
    const mappings = detectColumnMappings(['Email', 'First Name', 'Last Name', 'Company']);
    const fields = mappings.map((m) => m.leadField);
    expect(fields).toContain('email');
    expect(fields).toContain('firstName');
    expect(fields).toContain('lastName');
    expect(fields).toContain('company');
  });

  it('detects alias headers', () => {
    const mappings = detectColumnMappings(['E-mail Address', 'Organisation', 'Mobile Phone']);
    expect(mappings).toHaveLength(3);
    expect(mappings.find((m) => m.leadField === 'email')).toBeDefined();
    expect(mappings.find((m) => m.leadField === 'company')).toBeDefined();
    expect(mappings.find((m) => m.leadField === 'phone')).toBeDefined();
  });

  it('does not duplicate fields', () => {
    const mappings = detectColumnMappings(['Email', 'E-mail Address', 'Business Email']);
    const emailMappings = mappings.filter((m) => m.leadField === 'email');
    expect(emailMappings).toHaveLength(1);
  });

  it('assigns confidence 1.0 for exact matches and 0.9 for aliases', () => {
    const mappings = detectColumnMappings(['email', 'E-mail Address']);
    const exact = mappings.find((m) => m.csvColumn === 'email');
    expect(exact!.confidence).toBe(1.0);
    expect(exact!.reason).toBe('header-exact');
  });

  it('returns empty for unrecognized headers', () => {
    const mappings = detectColumnMappings(['ZZZZZ', 'Unknown Column', 'Random Data']);
    expect(mappings).toHaveLength(0);
  });

  it('detects custom field targets', () => {
    const mappings = detectColumnMappings(['Google URL', 'Rating', 'AI Chatbot']);
    expect(mappings).toHaveLength(3);
    expect(mappings.find((m) => m.leadField === 'googleUrl')).toBeDefined();
    expect(mappings.find((m) => m.leadField === 'rating')).toBeDefined();
    expect(mappings.find((m) => m.leadField === 'aiChatbot')).toBeDefined();
  });
});

describe('buildMappingsRecord', () => {
  it('builds a record from mappings', () => {
    const record = buildMappingsRecord([
      { csvColumn: 'Email', leadField: 'email', confidence: 1, reason: 'header-exact' },
      { csvColumn: 'Name', leadField: 'fullName', confidence: 0.9, reason: 'header-alias' },
    ]);
    expect(record).toEqual({ Email: 'email', Name: 'fullName' });
  });

  it('skips mappings without leadField', () => {
    const record = buildMappingsRecord([
      { csvColumn: 'Unknown', leadField: '', confidence: 0, reason: '' },
    ]);
    expect(record).toEqual({});
  });
});

describe('isCustomField', () => {
  it('returns true for custom field targets', () => {
    expect(isCustomField('googleUrl')).toBe(true);
    expect(isCustomField('rating')).toBe(true);
    expect(isCustomField('aiChatbot')).toBe(true);
  });

  it('returns false for lead fields', () => {
    expect(isCustomField('email')).toBe(false);
    expect(isCustomField('firstName')).toBe(false);
  });
});

describe('LEAD_FIELDS', () => {
  it('includes core lead fields', () => {
    expect(LEAD_FIELDS).toContain('email');
    expect(LEAD_FIELDS).toContain('firstName');
    expect(LEAD_FIELDS).toContain('lastName');
    expect(LEAD_FIELDS).toContain('company');
  });
});

describe('CUSTOM_FIELD_TARGETS', () => {
  it('includes custom field keys', () => {
    expect(CUSTOM_FIELD_TARGETS).toContain('socialAccount');
    expect(CUSTOM_FIELD_TARGETS).toContain('googleUrl');
    expect(CUSTOM_FIELD_TARGETS).toContain('rating');
  });
});
