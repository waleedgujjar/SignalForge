import { describe, expect, it } from 'vitest';
import { MockAIProvider } from './mock-provider.js';

describe('MockAIProvider', () => {
  const provider = new MockAIProvider();

  it('returns deterministic lead scores', async () => {
    const result = await provider.scoreLead({
      leadId: 'lead_test_001',
      company: 'Acme Corp',
      title: 'Head of Sales',
    });

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('classifies interested replies', async () => {
    const result = await provider.classifyReply({
      messageId: 'msg_001',
      body: 'We are interested in learning more.',
    });

    expect(result.category).toBe('INTERESTED');
    expect(result.confidence).toBe(0.91);
  });

  describe('enrichLead opportunityAssessment', () => {
    const ASSESSMENT_KEYS = [
      'icpFit',
      'serviceFit',
      'aiReceptionistOpportunity',
      'customerResponseOpportunity',
      'appointmentBookingOpportunity',
      'websiteOpportunity',
      'leadQuality',
    ] as const;

    it('answers UNKNOWN for every entry when no website and no LinkedIn data exist', async () => {
      // Absence of evidence is never reported as a finding.
      const result = await provider.enrichLead({
        lead: { email: 'someone@example.com' },
        serviceCatalog: [],
      });

      const assessment = result.opportunityAssessment;
      expect(assessment).toBeDefined();
      for (const key of ASSESSMENT_KEYS) {
        expect(assessment![key], key).toEqual({ value: null, status: 'UNKNOWN', evidence: [] });
      }
    });

    it('still answers UNKNOWN for website-derived entries when an ICP exists but nothing was analyzed', async () => {
      const result = await provider.enrichLead({
        lead: { email: 'someone@example.com' },
        icpProfile: {
          targetIndustries: ['Dental'],
          targetCountries: [],
          targetCompanySizes: ['11-50'],
          targetJobTitles: [],
          targetSeniorities: [],
        },
        serviceCatalog: [],
      });

      const assessment = result.opportunityAssessment!;
      expect(assessment.icpFit.status).toBe('UNKNOWN');
      expect(assessment.aiReceptionistOpportunity.status).toBe('UNKNOWN');
      expect(assessment.websiteOpportunity.status).toBe('UNKNOWN');
    });

    it('leaves automation opportunities unknown when only deterministic website scores are available', async () => {
      const result = await provider.enrichLead({
        lead: { email: 'owner@riverside-dental.com', company: 'Riverside Dental' },
        websiteIntelligence: {
          websiteScore: 42,
          opportunityScore: 70,
        },
        serviceCatalog: [],
      });

      const assessment = result.opportunityAssessment!;
      expect(assessment.aiReceptionistOpportunity.status).toBe('UNKNOWN');
      expect(assessment.customerResponseOpportunity.status).toBe('UNKNOWN');
      expect(assessment.appointmentBookingOpportunity.status).toBe('UNKNOWN');
      expect(assessment.websiteOpportunity).toEqual({ value: 'HIGH', status: 'INFERRED', evidence: ['Website score 42/100'] });
    });

    it('never marks an entry VERIFIED from INFERRED LinkedIn research', async () => {
      const result = await provider.enrichLead({
        lead: { email: 'jane@example.com', company: 'Example Co' },
        linkedInResearch: {
          person: { title: 'Founder' },
          confidence: 'MEDIUM',
          verification: 'INFERRED',
          provenance: [],
          retrievedAt: null,
          sourceUrls: [],
        },
        serviceCatalog: [],
      });

      expect(result.opportunityAssessment!.leadQuality.status).toBe('INFERRED');
      expect(result.opportunityAssessment!.leadQuality.evidence.join(' ')).toContain('Founder');
    });

    it('marks lead quality VERIFIED only when the cited LinkedIn research is VERIFIED', async () => {
      const result = await provider.enrichLead({
        lead: { email: 'jane@example.com', company: 'Example Co' },
        linkedInResearch: {
          person: { title: 'Founder' },
          confidence: 'HIGH',
          verification: 'VERIFIED',
          provenance: [],
          retrievedAt: null,
          sourceUrls: [],
        },
        serviceCatalog: [],
      });

      expect(result.opportunityAssessment!.leadQuality.status).toBe('VERIFIED');
    });
  });
});
