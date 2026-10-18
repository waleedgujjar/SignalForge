import { describe, expect, it } from 'vitest';
import {
  inferSeniority,
  inferDepartment,
  calculateICPFitScore,
  calculateLeadQualityScore,
  calculateProspectScore,
  buildDynamicVariables,
  parseEmployeeRange,
  companySizeMatches,
} from './scoring.js';

describe('parseEmployeeRange', () => {
  it.each([
    ['11-50 employees', { min: 11, max: 50 }],
    ['51-200', { min: 51, max: 200 }],
    ['1,001-5,000', { min: 1001, max: 5000 }],
    ['1,001-5,000 employees', { min: 1001, max: 5000 }],
    ['10,001+', { min: 10001, max: null }],
    ['10,001+ employees', { min: 10001, max: null }],
    ['1-10', { min: 1, max: 10 }],
    ['501–1,000 employees', { min: 501, max: 1000 }],
    ['self-employed', { min: 1, max: 1 }],
    ['Myself Only', { min: 1, max: 1 }],
    ['201', { min: 201, max: 201 }],
    ['201 employees', { min: 201, max: 201 }],
  ])('parses %s', (input, expected) => {
    expect(parseEmployeeRange(input)).toEqual(expected);
  });

  it.each(['', '   ', 'Enterprise', 'Founded 1998', null, undefined])('returns null for unparseable %s', input => {
    expect(parseEmployeeRange(input)).toBeNull();
  });
});

describe('companySizeMatches', () => {
  it('matches overlapping ranges regardless of formatting', () => {
    expect(companySizeMatches('11-50 employees', '11-50')).toBe(true);
    expect(companySizeMatches('1,001-5,000 employees', '1001-5000')).toBe(true);
    expect(companySizeMatches('10,001+', '5001-10000')).toBe(false);
    expect(companySizeMatches('10,001+', '10001+')).toBe(true);
    expect(companySizeMatches('201', '51-200')).toBe(false);
    expect(companySizeMatches('201', '201-500')).toBe(true);
  });

  it('does not match disjoint ranges', () => {
    expect(companySizeMatches('11-50 employees', '201-500')).toBe(false);
    expect(companySizeMatches('self-employed', '11-50')).toBe(false);
  });

  it('falls back to case-insensitive equality when a side is unparseable', () => {
    expect(companySizeMatches('Enterprise', 'enterprise')).toBe(true);
    expect(companySizeMatches('Enterprise', '11-50')).toBe(false);
    expect(companySizeMatches('11-50', 'Enterprise')).toBe(false);
  });

  it('never matches an empty side', () => {
    expect(companySizeMatches('', '11-50')).toBe(false);
    expect(companySizeMatches('11-50', null)).toBe(false);
    expect(companySizeMatches(undefined, undefined)).toBe(false);
  });
});

describe('inferSeniority', () => {
  it('returns EXECUTIVE for C-suite titles', () => {
    expect(inferSeniority('CEO')).toBe('EXECUTIVE');
    expect(inferSeniority('CTO')).toBe('EXECUTIVE');
    expect(inferSeniority('Co-Founder & CEO')).toBe('EXECUTIVE');
    expect(inferSeniority('President')).toBe('EXECUTIVE');
    expect(inferSeniority('Partner')).toBe('EXECUTIVE');
    expect(inferSeniority('Founder')).toBe('EXECUTIVE');
    expect(inferSeniority('Owner')).toBe('EXECUTIVE');
  });

  it('returns VP for vice president titles', () => {
    expect(inferSeniority('VP of Sales')).toBe('VP');
    expect(inferSeniority('SVP Engineering')).toBe('VP');
    expect(inferSeniority('EVP Operations')).toBe('VP');
  });

  it('returns DIRECTOR for director titles', () => {
    expect(inferSeniority('Director of Engineering')).toBe('DIRECTOR');
    expect(inferSeniority('Sales Director')).toBe('DIRECTOR');
  });

  it('returns MANAGER for manager/lead titles', () => {
    expect(inferSeniority('Engineering Manager')).toBe('MANAGER');
    expect(inferSeniority('Team Lead')).toBe('MANAGER');
    expect(inferSeniority('Head of Marketing')).toBe('MANAGER');
  });

  it('returns INDIVIDUAL_CONTRIBUTOR for other titles', () => {
    expect(inferSeniority('Software Engineer')).toBe('INDIVIDUAL_CONTRIBUTOR');
    expect(inferSeniority('Account Executive')).toBe('INDIVIDUAL_CONTRIBUTOR');
    expect(inferSeniority('Designer')).toBe('INDIVIDUAL_CONTRIBUTOR');
  });

  it('returns UNKNOWN for null/undefined', () => {
    expect(inferSeniority(null)).toBe('UNKNOWN');
    expect(inferSeniority(undefined)).toBe('UNKNOWN');
    expect(inferSeniority('')).toBe('UNKNOWN');
  });
});

describe('inferDepartment', () => {
  it('maps sales titles', () => {
    expect(inferDepartment('Account Executive')).toBe('Sales');
    expect(inferDepartment('BDR')).toBe('Sales');
    expect(inferDepartment('Sales Manager')).toBe('Sales');
  });

  it('maps marketing titles', () => {
    expect(inferDepartment('Marketing Manager')).toBe('Marketing');
    expect(inferDepartment('Growth Lead')).toBe('Marketing');
  });

  it('maps engineering titles', () => {
    expect(inferDepartment('Software Engineer')).toBe('Engineering');
    expect(inferDepartment('DevOps Lead')).toBe('Engineering');
    expect(inferDepartment('Data Scientist')).toBe('Engineering');
  });

  it('maps executive titles', () => {
    expect(inferDepartment('CEO')).toBe('Executive');
    expect(inferDepartment('Founder')).toBe('Executive');
  });

  it('returns null for unknown', () => {
    expect(inferDepartment(null)).toBeNull();
    expect(inferDepartment('Astronaut')).toBeNull();
  });
});

describe('calculateICPFitScore', () => {
  const fullICP = {
    targetIndustries: ['SaaS', 'Technology'],
    targetCountries: ['US', 'United States'],
    targetCompanySizes: ['51-200'],
    targetJobTitles: ['Manager', 'Director'],
    targetSeniorities: ['MANAGER', 'DIRECTOR'],
  };

  it('returns 50 when no ICP profile exists', () => {
    const result = calculateICPFitScore({ industry: 'SaaS' }, null);
    expect(result.score).toBe(50);
  });

  it('scores full match with all criteria', () => {
    const result = calculateICPFitScore(
      { industry: 'SaaS', country: 'United States', jobTitle: 'Engineering Manager' },
      fullICP,
    );
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.breakdown.industry).toBe(100);
    expect(result.breakdown.location).toBe(100);
    expect(result.breakdown.jobTitle).toBe(100);
    expect(result.breakdown.seniority).toBe(100);
  });

  it('scores zero for non-matching lead', () => {
    const result = calculateICPFitScore(
      { industry: 'Healthcare', country: 'Brazil', jobTitle: 'Intern' },
      fullICP,
    );
    expect(result.score).toBeLessThanOrEqual(15);
    expect(result.breakdown.industry).toBe(0);
    expect(result.breakdown.location).toBe(0);
    expect(result.dimensionResults.industry).toEqual({ score: 0, status: 'MISMATCH' });
    expect(result.dimensionResults.location).toEqual({ score: 0, status: 'MISMATCH' });
  });

  it('scores 100 for all empty ICP criteria', () => {
    const emptyICP = {
      targetIndustries: [],
      targetCountries: [],
      targetCompanySizes: [],
      targetJobTitles: [],
      targetSeniorities: [],
    };
    const result = calculateICPFitScore({ industry: 'Anything' }, emptyICP);
    expect(result.score).toBe(100);
  });

  it('matches country code', () => {
    const result = calculateICPFitScore(
      { countryCode: 'US', industry: 'SaaS', jobTitle: 'Manager' },
      fullICP,
    );
    expect(result.breakdown.location).toBe(100);
  });

  it('is case insensitive for industry match', () => {
    const result = calculateICPFitScore(
      { industry: 'saas' },
      { ...fullICP, targetIndustries: ['SaaS'] },
    );
    expect(result.breakdown.industry).toBe(100);
  });

  describe('companySize', () => {
    it('stays at the neutral 50 when no company size is known', () => {
      expect(calculateICPFitScore({ industry: 'SaaS' }, fullICP).breakdown.companySize).toBe(50);
      expect(calculateICPFitScore({ industry: 'SaaS', companySize: null }, fullICP).breakdown.companySize).toBe(50);
      expect(calculateICPFitScore({ industry: 'SaaS', companySize: '   ' }, fullICP).breakdown.companySize).toBe(50);
    });

    it('scores 100 when the researched range matches a target size', () => {
      const result = calculateICPFitScore({ companySize: '51-200 employees' }, fullICP);
      expect(result.breakdown.companySize).toBe(100);
    });

    it('matches formatted ranges against compact targets', () => {
      const result = calculateICPFitScore(
        { companySize: '1,001-5,000 employees' },
        { ...fullICP, targetCompanySizes: ['1001-5000'] },
      );
      expect(result.breakdown.companySize).toBe(100);
    });

    it('scores 0 when the researched range misses every target size', () => {
      const result = calculateICPFitScore({ companySize: '10,001+' }, fullICP);
      expect(result.breakdown.companySize).toBe(0);
    });

    it('scores 100 when the ICP has no company size targets', () => {
      const result = calculateICPFitScore(
        { companySize: '10,001+' },
        { ...fullICP, targetCompanySizes: [] },
      );
      expect(result.breakdown.companySize).toBe(100);
    });

    it('leaves the weighted formula unchanged for a full match', () => {
      const result = calculateICPFitScore(
        { industry: 'SaaS', country: 'United States', jobTitle: 'Engineering Manager', companySize: '51-200' },
        fullICP,
      );
      expect(result.score).toBe(100);
    });
  });

  describe('UNKNOWN ≠ MISMATCH — missing data scores 50', () => {
    it('scores industry as UNKNOWN (50) when lead has no industry', () => {
      const result = calculateICPFitScore({}, fullICP);
      expect(result.breakdown.industry).toBe(50);
      expect(result.dimensionResults.industry).toEqual({ score: 50, status: 'UNKNOWN' });
    });

    it('scores location as UNKNOWN (50) when lead has no country or countryCode', () => {
      const result = calculateICPFitScore({}, fullICP);
      expect(result.breakdown.location).toBe(50);
      expect(result.dimensionResults.location).toEqual({ score: 50, status: 'UNKNOWN' });
    });

    it('scores jobTitle as UNKNOWN (50) when lead has no jobTitle', () => {
      const result = calculateICPFitScore({}, fullICP);
      expect(result.breakdown.jobTitle).toBe(50);
      expect(result.dimensionResults.jobTitle).toEqual({ score: 50, status: 'UNKNOWN' });
    });

    it('scores seniority as UNKNOWN (50) when inferred seniority is UNKNOWN', () => {
      const result = calculateICPFitScore({}, fullICP);
      expect(result.breakdown.seniority).toBe(50);
      expect(result.dimensionResults.seniority).toEqual({ score: 50, status: 'UNKNOWN' });
    });

    it('still scores 0 (MISMATCH) when data IS present but wrong', () => {
      const result = calculateICPFitScore({ industry: 'Healthcare' }, fullICP);
      expect(result.breakdown.industry).toBe(0);
      expect(result.dimensionResults.industry?.status).toBe('MISMATCH');
    });
  });

  describe('dimensionResults', () => {
    it('returns MATCH status for matching dimensions', () => {
      const result = calculateICPFitScore(
        { industry: 'SaaS', country: 'United States', jobTitle: 'Engineering Manager' },
        fullICP,
      );
      expect(result.dimensionResults.industry?.status).toBe('MATCH');
      expect(result.dimensionResults.location?.status).toBe('MATCH');
      expect(result.dimensionResults.jobTitle?.status).toBe('MATCH');
      expect(result.dimensionResults.seniority?.status).toBe('MATCH');
    });

    it('returns all UNKNOWN when no ICP profile', () => {
      const result = calculateICPFitScore({}, null);
      for (const dim of Object.values(result.dimensionResults)) {
        expect(dim.status).toBe('UNKNOWN');
        expect(dim.score).toBe(50);
      }
    });
  });
});

describe('calculateLeadQualityScore', () => {
  it('scores high for verified email with complete data', () => {
    const result = calculateLeadQualityScore(
      { firstName: 'John', lastName: 'Doe', jobTitle: 'CEO', phone: '+1234', linkedinUrl: 'https://linkedin.com/in/jd', company: 'Acme', companyDomain: 'acme.com', industry: 'Tech' },
      { status: 'VERIFIED' },
      true,
    );
    expect(result.score).toBe(100);
    expect(result.breakdown.emailVerification).toBe(100);
    expect(result.breakdown.contactCompleteness).toBe(100);
    expect(result.breakdown.companyCompleteness).toBe(100);
    expect(result.breakdown.websitePresence).toBe(100);
  });

  it('scores low for invalid email with sparse data', () => {
    const result = calculateLeadQualityScore(
      { firstName: null, lastName: null, jobTitle: null, phone: null, linkedinUrl: null, company: null, companyDomain: null, industry: null },
      { status: 'INVALID' },
      false,
    );
    expect(result.score).toBe(0);
    expect(result.breakdown.emailVerification).toBe(0);
    expect(result.breakdown.contactCompleteness).toBe(0);
    expect(result.breakdown.companyCompleteness).toBe(0);
    expect(result.breakdown.websitePresence).toBe(0);
  });

  it('handles risky verification', () => {
    const result = calculateLeadQualityScore({}, { status: 'RISKY' }, false);
    expect(result.breakdown.emailVerification).toBe(50);
  });

  it('handles no verification (unknown)', () => {
    const result = calculateLeadQualityScore({}, null, false);
    expect(result.breakdown.emailVerification).toBe(25);
  });

  it('scores website presence at 50 if domain exists but no analysis', () => {
    const result = calculateLeadQualityScore(
      { companyDomain: 'example.com' },
      null,
      false,
    );
    expect(result.breakdown.websitePresence).toBe(50);
  });
});

describe('calculateProspectScore', () => {
  it('returns VERY_HIGH for high scores', () => {
    const result = calculateProspectScore(100, 100, 100, 'EXECUTIVE');
    expect(result.priority).toBe('VERY_HIGH');
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('returns HIGH for moderate scores', () => {
    const result = calculateProspectScore(70, 70, 70, 'DIRECTOR');
    expect(result.priority).toBe('HIGH');
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.score).toBeLessThan(80);
  });

  it('returns MEDIUM for mid-range scores', () => {
    const result = calculateProspectScore(50, 50, 50, 'INDIVIDUAL_CONTRIBUTOR');
    expect(result.priority).toBe('MEDIUM');
    expect(result.score).toBeGreaterThanOrEqual(40);
  });

  it('returns LOW for poor scores', () => {
    const result = calculateProspectScore(10, 10, 10, 'UNKNOWN');
    expect(result.priority).toBe('LOW');
    expect(result.score).toBeLessThan(40);
  });

  it('uses 50 as default when opportunityScore is null', () => {
    const withNull = calculateProspectScore(60, 60, null, 'MANAGER');
    const with50 = calculateProspectScore(60, 60, 50, 'MANAGER');
    expect(withNull.score).toBe(with50.score);
  });

  it('clamps score to 0-100', () => {
    const result = calculateProspectScore(0, 0, 0, 'UNKNOWN');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('includes correct breakdown weights', () => {
    const result = calculateProspectScore(100, 100, 100, 'EXECUTIVE');
    expect(result.breakdown.icpFit).toBe(35);
    expect(result.breakdown.leadQuality).toBe(25);
    expect(result.breakdown.opportunity).toBe(25);
    expect(result.breakdown.contactRelevance).toBe(15);
  });
});

describe('buildDynamicVariables', () => {
  const baseLead = {
    firstName: 'Alice',
    lastName: 'Smith',
    fullName: 'Alice Smith',
    email: 'alice@acme.com',
    company: 'Acme Corp',
    companyDomain: 'acme.com',
    jobTitle: 'VP Sales',
    industry: 'SaaS',
    city: 'San Francisco',
    state: 'CA',
    country: 'US',
  };

  it('maps all lead fields', () => {
    const vars = buildDynamicVariables(baseLead, null, null);
    expect(vars['first_name']).toBe('Alice');
    expect(vars['last_name']).toBe('Smith');
    expect(vars['full_name']).toBe('Alice Smith');
    expect(vars['email']).toBe('alice@acme.com');
    expect(vars['company_name']).toBe('Acme Corp');
    expect(vars['job_title']).toBe('VP Sales');
  });

  it('includes website analysis data', () => {
    const vars = buildDynamicVariables(baseLead, null, { websiteScore: 75, opportunityScore: 80 });
    expect(vars['website_score']).toBe('75');
    expect(vars['opportunity_score']).toBe('80');
  });

  it('includes enrichment data', () => {
    const enrichment = {
      recommendedServices: [{ service: 'SEO Audit', score: 90 }],
      painPointHypotheses: [{ observation: 'slow site', hypothesis: 'needs perf work' }],
      personalizationHooks: [{ observation: 'new funding', angle: 'growth stage' }],
      outreachAngles: [{ angle: 'perf improvement', reasoning: 'site is slow' }],
    };
    const vars = buildDynamicVariables(baseLead, enrichment, null);
    expect(vars['recommended_service']).toBe('SEO Audit');
    expect(vars['pain_point']).toBe('needs perf work');
    expect(vars['personalization_hook']).toBe('growth stage');
    expect(vars['outreach_angle']).toBe('perf improvement');
    expect(vars['top_opportunity']).toBe('SEO Audit');
  });

  it('falls back to hypothesis for top_opportunity when no service', () => {
    const enrichment = {
      recommendedServices: [],
      painPointHypotheses: [{ observation: 'x', hypothesis: 'needs help' }],
      personalizationHooks: [],
      outreachAngles: [],
    };
    const vars = buildDynamicVariables(baseLead, enrichment, null);
    expect(vars['top_opportunity']).toBe('needs help');
  });

  it('builds full_name from parts when fullName is null', () => {
    const vars = buildDynamicVariables({ ...baseLead, fullName: null }, null, null);
    expect(vars['full_name']).toBe('Alice Smith');
  });

  it('handles empty lead gracefully', () => {
    const vars = buildDynamicVariables(
      { email: 'x@y.com', firstName: null, lastName: null, fullName: null },
      null,
      null,
    );
    expect(vars['first_name']).toBe('');
    expect(vars['email']).toBe('x@y.com');
    expect(vars['full_name']).toBe('');
  });
});
