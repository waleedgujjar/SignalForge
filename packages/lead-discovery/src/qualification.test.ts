import { describe, expect, it } from 'vitest';

import { normalizeLead } from './normalization.js';
import { deriveAiOpportunity, qualifyLead, QUALIFICATION_VERSION, type ResolvedIcpProfile } from './qualification.js';

const icp: ResolvedIcpProfile = {
  targetIndustries: ['Dental'],
  targetCountries: ['US'],
  targetCompanySizes: ['1-10', '11-50'],
  targetJobTitles: ['Founder', 'CEO'],
  targetSeniorities: ['EXECUTIVE'],
  minWebsiteScore: null,
  minOpportunityScore: null,
  requireVerifiedEmail: false,
};

const onTarget = normalizeLead({
  company: 'Riverside Dental',
  firstName: 'Jane',
  lastName: 'Doe',
  jobTitle: 'Founder',
  email: 'jane@riverside.com',
  phone: '+1 512 555 0142',
  website: 'https://riverside.com',
  industry: 'Dental',
  countryCode: 'US',
  city: 'Austin',
});

describe('qualifyLead', () => {
  it('scores an on-target lead highly', () => {
    const result = qualifyLead(onTarget, icp, { verificationStatus: 'VERIFIED', hasWebsiteAnalysis: true });
    expect(result.icpFitScore).toBeGreaterThan(80);
    expect(result.qualified).toBe(true);
  });

  it('scores an off-target lead lower than an on-target one', () => {
    const offTarget = normalizeLead({
      company: 'Globex Logistics',
      jobTitle: 'Intern',
      industry: 'Logistics',
      countryCode: 'DE',
    });
    const good = qualifyLead(onTarget, icp);
    const bad = qualifyLead(offTarget, icp);
    expect(bad.icpFitScore).toBeLessThan(good.icpFitScore);
  });

  it('falls back to a neutral score when no ICP is configured', () => {
    // A brand-new workspace must still be able to run discovery.
    const result = qualifyLead(onTarget, null);
    expect(result.icpFitScore).toBe(50);
  });

  it('fails a lead below the minimum score and says why', () => {
    const weak = normalizeLead({ company: 'Nowhere Ltd', industry: 'Mining', countryCode: 'DE' });
    const result = qualifyLead(weak, icp, {}, 90);
    expect(result.qualified).toBe(false);
    expect(result.reason).toContain('below the minimum');
  });

  it('enforces requireVerifiedEmail when the ICP asks for it', () => {
    const strict = { ...icp, requireVerifiedEmail: true };
    const unverified = qualifyLead(onTarget, strict, { verificationStatus: 'UNKNOWN' });
    expect(unverified.qualified).toBe(false);
    expect(unverified.reason).toContain('verified email');

    const verified = qualifyLead(onTarget, strict, { verificationStatus: 'VERIFIED' });
    expect(verified.qualified).toBe(true);
  });

  it('does not fail a lead on website score before its site was analyzed', () => {
    const strict = { ...icp, minWebsiteScore: 80 };
    const notYetAnalyzed = qualifyLead(onTarget, strict, { hasWebsiteAnalysis: false });
    expect(notYetAnalyzed.qualified).toBe(true);

    const analyzedAndWeak = qualifyLead(onTarget, strict, { hasWebsiteAnalysis: true, websiteScore: 20 });
    expect(analyzedAndWeak.qualified).toBe(false);
  });
});

describe('qualifyLead with LinkedIn research', () => {
  const untitled = normalizeLead({
    company: 'Riverside Dental',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@riverside.com',
    industry: 'Dental',
    countryCode: 'US',
  });

  it('falls back to a researched title when the lead has none, lifting seniority', () => {
    const without = qualifyLead(untitled, icp);
    const withResearch = qualifyLead(untitled, icp, { linkedInResearch: { jobTitle: 'Founder' } });

    expect(without.breakdown.seniority).toBe(50);
    expect(without.breakdown.jobTitle).toBe(50);
    expect(withResearch.breakdown.seniority).toBe(100);
    expect(withResearch.breakdown.jobTitle).toBe(100);
    expect(withResearch.breakdown.contactRelevance).toBeGreaterThan(without.breakdown.contactRelevance!);
    expect(withResearch.prospectScore).toBeGreaterThan(without.prospectScore);
  });

  it('never overrides a title the lead already has', () => {
    const result = qualifyLead(onTarget, icp, { linkedInResearch: { jobTitle: 'Intern' } });
    expect(result.breakdown.seniority).toBe(100);
    expect(result.breakdown.jobTitle).toBe(100);
  });

  it('matches a researched employee range against the ICP company sizes', () => {
    const match = qualifyLead(onTarget, icp, { linkedInResearch: { employeeRange: '11-50 employees' } });
    expect(match.breakdown.companySize).toBe(100);

    const miss = qualifyLead(onTarget, icp, { linkedInResearch: { employeeRange: '201-500 employees' } });
    expect(miss.breakdown.companySize).toBe(0);
    expect(miss.icpFitScore).toBeLessThan(match.icpFitScore);
  });

  it('counts a researched profile URL towards contact completeness', () => {
    const without = qualifyLead(onTarget, icp);
    const withUrl = qualifyLead(onTarget, icp, {
      linkedInResearch: { profileUrl: 'https://www.linkedin.com/in/jane-doe' },
    });
    expect(withUrl.leadQualityScore).toBeGreaterThan(without.leadQualityScore);
  });

  it('produces exactly the same scores as before when no research exists', () => {
    // Regression guard: these are the pre-Module-17 values for this lead
    // (companySize neutral 50, seniority from the lead's own title).
    const expected = { icpFitScore: 93, leadQualityScore: 64, prospectScore: 76, priority: 'HIGH' };

    for (const signals of [undefined, { linkedInResearch: null }, { linkedInResearch: {} }]) {
      const result = qualifyLead(onTarget, icp, signals);
      expect(result).toMatchObject(expected);
      expect(result.breakdown.companySize).toBe(50);
    }
  });
});

describe('qualification signals and versioning', () => {
  it('returns signals array and version on every outcome', () => {
    const result = qualifyLead(onTarget, icp, { verificationStatus: 'VERIFIED', hasWebsiteAnalysis: true });
    expect(result.version).toBe(QUALIFICATION_VERSION);
    expect(result.signals).toBeDefined();
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('produces MATCH signals for an on-target lead', () => {
    const result = qualifyLead(onTarget, icp, { verificationStatus: 'VERIFIED', hasWebsiteAnalysis: true });
    const industrySig = result.signals.find(s => s.dimension === 'industry');
    expect(industrySig).toMatchObject({ code: 'INDUSTRY_MATCH', status: 'MATCH', score: 100 });
    const locationSig = result.signals.find(s => s.dimension === 'location');
    expect(locationSig).toMatchObject({ code: 'LOCATION_MATCH', status: 'MATCH', score: 100 });
    const emailSig = result.signals.find(s => s.dimension === 'email');
    expect(emailSig).toMatchObject({ code: 'EMAIL_VERIFIED', status: 'MATCH', score: 100 });
  });

  it('produces UNKNOWN signals when data is missing', () => {
    const sparse = normalizeLead({ company: 'Bare Minimum' });
    const result = qualifyLead(sparse, icp);
    const industrySig = result.signals.find(s => s.dimension === 'industry');
    expect(industrySig).toMatchObject({ code: 'INDUSTRY_UNKNOWN', status: 'UNKNOWN', score: 50 });
    const locationSig = result.signals.find(s => s.dimension === 'location');
    expect(locationSig).toMatchObject({ code: 'LOCATION_UNKNOWN', status: 'UNKNOWN', score: 50 });
    const jobTitleSig = result.signals.find(s => s.dimension === 'jobTitle');
    expect(jobTitleSig).toMatchObject({ code: 'JOB_TITLE_UNKNOWN', status: 'UNKNOWN', score: 50 });
  });

  it('produces MISMATCH signals for wrong data', () => {
    const wrong = normalizeLead({ company: 'Wrong Corp', industry: 'Mining', countryCode: 'DE', jobTitle: 'Intern' });
    const result = qualifyLead(wrong, icp);
    const industrySig = result.signals.find(s => s.dimension === 'industry');
    expect(industrySig).toMatchObject({ code: 'INDUSTRY_MISMATCH', status: 'MISMATCH', score: 0 });
    const locationSig = result.signals.find(s => s.dimension === 'location');
    expect(locationSig).toMatchObject({ code: 'LOCATION_MISMATCH', status: 'MISMATCH', score: 0 });
  });

  it('includes NO_EMAIL signal when lead has no email', () => {
    const noEmail = normalizeLead({ company: 'No Email Co' });
    const result = qualifyLead(noEmail, icp);
    const emailSig = result.signals.find(s => s.dimension === 'email');
    expect(emailSig).toMatchObject({ code: 'NO_EMAIL', status: 'UNKNOWN' });
  });

  it('includes threshold signal', () => {
    const result = qualifyLead(onTarget, icp, {}, 50);
    const thresholdSig = result.signals.find(s => s.dimension === 'threshold');
    expect(thresholdSig).toBeDefined();
    expect(thresholdSig!.code).toBe('SCORE_ABOVE_THRESHOLD');
    expect(thresholdSig!.detail).toBe('threshold=50');
  });

  it('includes VERIFIED_EMAIL_REQUIRED gate signal when ICP requires it and email is not verified', () => {
    const strict = { ...icp, requireVerifiedEmail: true };
    const result = qualifyLead(onTarget, strict, { verificationStatus: 'UNKNOWN' });
    expect(result.qualified).toBe(false);
    const gate = result.signals.find(s => s.code === 'VERIFIED_EMAIL_REQUIRED');
    expect(gate).toBeDefined();
  });
});

describe('HVAC Houston integration scenario', () => {
  const hvacIcp: ResolvedIcpProfile = {
    targetIndustries: ['HVAC', 'Heating & Air Conditioning'],
    targetCountries: ['US'],
    targetCompanySizes: ['1-10', '11-50'],
    targetJobTitles: ['Owner', 'Founder', 'President'],
    targetSeniorities: ['EXECUTIVE'],
    minWebsiteScore: null,
    minOpportunityScore: null,
    requireVerifiedEmail: false,
  };

  it('qualifies an HVAC contractor in Houston with high score', () => {
    const lead = normalizeLead({
      company: 'Cool Breeze HVAC',
      fullName: 'Mike Johnson',
      jobTitle: 'Owner',
      email: 'mike@coolbreezehvac.com',
      phone: '+17135551234',
      website: 'https://coolbreezehvac.com',
      industry: 'HVAC',
      countryCode: 'US',
      state: 'Texas',
      city: 'Houston',
    });
    const result = qualifyLead(lead, hvacIcp, { verificationStatus: 'VERIFIED' });
    expect(result.qualified).toBe(true);
    expect(result.icpFitScore).toBeGreaterThan(80);
    expect(result.version).toBe(QUALIFICATION_VERSION);

    const industrySig = result.signals.find(s => s.dimension === 'industry');
    expect(industrySig).toMatchObject({ code: 'INDUSTRY_MATCH', status: 'MATCH' });
    const locationSig = result.signals.find(s => s.dimension === 'location');
    expect(locationSig).toMatchObject({ code: 'LOCATION_MATCH', status: 'MATCH' });
  });

  it('scores a lead with missing industry as UNKNOWN, not MISMATCH', () => {
    const lead = normalizeLead({
      company: 'No Industry LLC',
      jobTitle: 'Owner',
      countryCode: 'US',
      city: 'Houston',
    });
    const result = qualifyLead(lead, hvacIcp);
    const industrySig = result.signals.find(s => s.dimension === 'industry');
    expect(industrySig).toMatchObject({ code: 'INDUSTRY_UNKNOWN', status: 'UNKNOWN', score: 50 });
    expect(result.icpFitScore).toBeGreaterThan(0);
  });

  it('scores a non-HVAC lead as INDUSTRY_MISMATCH with score 0 on that dimension', () => {
    const lead = normalizeLead({
      company: 'Pizza Palace',
      jobTitle: 'Owner',
      industry: 'Restaurant',
      countryCode: 'US',
      city: 'Houston',
    });
    const result = qualifyLead(lead, hvacIcp);
    const industrySig = result.signals.find(s => s.dimension === 'industry');
    expect(industrySig).toMatchObject({ code: 'INDUSTRY_MISMATCH', status: 'MISMATCH', score: 0 });
  });

  it('is idempotent — running twice produces the same result', () => {
    const lead = normalizeLead({
      company: 'Cool Breeze HVAC',
      jobTitle: 'Owner',
      industry: 'HVAC',
      countryCode: 'US',
    });
    const first = qualifyLead(lead, hvacIcp);
    const second = qualifyLead(lead, hvacIcp);
    expect(first).toEqual(second);
  });
});

describe('deriveAiOpportunity', () => {
  it('returns UNKNOWN when no website was analyzed', () => {
    // Never assert a company lacks automation when we never looked.
    expect(deriveAiOpportunity({ hasWebsiteAnalysis: false })).toBe('UNKNOWN');
  });

  it('returns HIGH when several automation signals are absent', () => {
    expect(
      deriveAiOpportunity({
        hasWebsiteAnalysis: true,
        hasChatbot: false,
        hasLiveChat: false,
        hasBookingWidget: false,
      }),
    ).toBe('HIGH');
  });

  it('returns LOW when the site already has automation', () => {
    expect(
      deriveAiOpportunity({
        hasWebsiteAnalysis: true,
        hasChatbot: true,
        hasLiveChat: true,
        hasBookingWidget: true,
      }),
    ).toBe('LOW');
  });
});
