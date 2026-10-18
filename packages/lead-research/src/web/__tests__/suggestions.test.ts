import { describe, expect, it } from 'vitest';
import { buildResearchSuggestions } from '../../suggestions.js';

describe('buildResearchSuggestions — WEB_SEARCH slot', () => {
  const baseLead = { linkedinUrl: null, website: null, companyDomain: null, jobTitle: null };
  const baseOptions = { enabled: false, hasWebsiteAnalysis: false, webResearchEnabled: false };

  it('shows WEB_SEARCH as available when lead has website and feature is on (test #15)', () => {
    const suggestions = buildResearchSuggestions(
      { ...baseLead, website: 'https://acme.com' },
      [],
      { ...baseOptions, webResearchEnabled: true },
    );
    const ws = suggestions.find((s) => s.key === 'WEB_SEARCH');
    expect(ws).toBeDefined();
    expect(ws!.available).toBe(true);
    expect(ws!.done).toBe(false);
    expect(ws!.label).toBe('Research Company Website');
  });

  it('shows WEB_SEARCH as available with companyDomain', () => {
    const suggestions = buildResearchSuggestions(
      { ...baseLead, companyDomain: 'acme.com' },
      [],
      { ...baseOptions, webResearchEnabled: true },
    );
    const ws = suggestions.find((s) => s.key === 'WEB_SEARCH');
    expect(ws!.available).toBe(true);
  });

  it('marks WEB_SEARCH as done when web research is completed', () => {
    const suggestions = buildResearchSuggestions(
      { ...baseLead, website: 'https://acme.com' },
      [{ source: 'WEB', researchType: 'COMPANY', status: 'COMPLETED', normalizedUrl: 'https://acme.com' }],
      { ...baseOptions, webResearchEnabled: true },
    );
    const ws = suggestions.find((s) => s.key === 'WEB_SEARCH');
    expect(ws!.done).toBe(true);
    expect(ws!.available).toBe(false);
  });

  it('shows WEB_SEARCH as unavailable when feature is off', () => {
    const suggestions = buildResearchSuggestions(
      { ...baseLead, website: 'https://acme.com' },
      [],
      { ...baseOptions, webResearchEnabled: false },
    );
    const ws = suggestions.find((s) => s.key === 'WEB_SEARCH');
    expect(ws!.available).toBe(false);
    expect(ws!.reason).toContain('disabled');
  });

  it('shows WEB_SEARCH as unavailable when no website', () => {
    const suggestions = buildResearchSuggestions(
      baseLead,
      [],
      { ...baseOptions, webResearchEnabled: true },
    );
    const ws = suggestions.find((s) => s.key === 'WEB_SEARCH');
    expect(ws!.available).toBe(false);
    expect(ws!.reason).toContain('No website');
  });

  it('defaults webResearchEnabled to false when not specified', () => {
    const suggestions = buildResearchSuggestions(
      { ...baseLead, website: 'https://acme.com' },
      [],
      { enabled: false, hasWebsiteAnalysis: false },
    );
    const ws = suggestions.find((s) => s.key === 'WEB_SEARCH');
    expect(ws!.available).toBe(false);
  });
});
