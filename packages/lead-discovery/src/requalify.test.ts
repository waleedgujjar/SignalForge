import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@signalforge/database', () => ({
  prisma: {
    iCPProfile: { findUnique: vi.fn() },
    discoveredLead: { findMany: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from '@signalforge/database';
import { requalifyLeads } from './requalify.js';

const db = prisma as unknown as {
  iCPProfile: { findUnique: ReturnType<typeof vi.fn> };
  discoveredLead: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

const DENTAL_ICP = {
  targetIndustries: ['Dental'],
  targetCountries: ['US'],
  targetCompanySizes: ['1-10', '11-50'],
  targetJobTitles: ['Founder', 'CEO'],
  targetSeniorities: ['EXECUTIVE'],
  weights: null,
  minWebsiteScore: null,
  minOpportunityScore: null,
  requireVerifiedEmail: false,
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dl-1',
    workspaceId: 'ws-1',
    company: 'Riverside Dental',
    normalizedCompany: 'riverside dental',
    firstName: 'Jane',
    lastName: 'Doe',
    fullName: 'Jane Doe',
    jobTitle: 'Founder',
    email: 'jane@riverside.com',
    normalizedEmail: 'jane@riverside.com',
    phone: '+15125550142',
    normalizedPhone: '+15125550142',
    website: 'https://riverside.com',
    normalizedDomain: 'riverside.com',
    industry: 'Dental',
    country: null,
    countryCode: 'US',
    state: null,
    city: 'Austin',
    postalCode: null,
    employeeCount: null,
    sourceId: 'ChIJ001',
    sourceUrl: null,
    emailStatus: 'VERIFIED',
    emailScore: 100,
    websiteScore: null,
    opportunityScore: null,
    qualified: true,
    ...overrides,
  };
}

describe('requalifyLeads', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.iCPProfile.findUnique.mockResolvedValue(DENTAL_ICP);
    db.discoveredLead.update.mockResolvedValue({});
    db.discoveredLead.findMany.mockResolvedValue([]);
  });

  it('requalifies a batch and tracks changes', async () => {
    db.discoveredLead.findMany.mockResolvedValueOnce([makeRow()]);

    const result = await requalifyLeads({ workspaceId: 'ws-1', jobId: 'job-1' });

    expect(result.requalified).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.newlyQualified).toBe(0);
    expect(result.newlyDisqualified).toBe(0);
    expect(db.discoveredLead.update).toHaveBeenCalledTimes(1);
    expect(db.discoveredLead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          qualificationVersion: 'v1',
          qualificationSignals: expect.any(Array),
        }),
      }),
    );
  });

  it('detects newly disqualified leads when minScore rises', async () => {
    db.discoveredLead.findMany.mockResolvedValueOnce([makeRow({ qualified: true })]);

    const result = await requalifyLeads({ workspaceId: 'ws-1', minScore: 99 });

    expect(result.requalified).toBe(1);
    expect(result.newlyDisqualified).toBe(1);
    expect(result.unchanged).toBe(0);
  });

  it('is idempotent — running twice gives same counts', async () => {
    db.discoveredLead.findMany.mockResolvedValueOnce([makeRow()]);
    const first = await requalifyLeads({ workspaceId: 'ws-1' });

    db.discoveredLead.findMany.mockResolvedValueOnce([makeRow()]);
    const second = await requalifyLeads({ workspaceId: 'ws-1' });

    expect(first.requalified).toBe(second.requalified);
    expect(first.unchanged).toBe(second.unchanged);
  });

  it('returns zero counts for an empty result set', async () => {
    const result = await requalifyLeads({ workspaceId: 'ws-1' });

    expect(result.requalified).toBe(0);
    expect(result.newlyQualified).toBe(0);
    expect(result.newlyDisqualified).toBe(0);
    expect(result.unchanged).toBe(0);
  });
});
