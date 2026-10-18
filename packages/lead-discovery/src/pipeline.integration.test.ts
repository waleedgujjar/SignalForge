import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────
// Only I/O boundaries are mocked. Normalization, dedup, and qualification run
// as real code so these tests exercise the full pipeline integration.

vi.mock('@signalforge/database', () => ({
  prisma: {
    leadDiscoveryJob: { findFirst: vi.fn(), update: vi.fn() },
    lead: { findMany: vi.fn() },
    iCPProfile: { findUnique: vi.fn() },
    discoveredLead: { upsert: vi.fn() },
  },
}));

vi.mock('@signalforge/config', () => ({
  getEnv: vi.fn().mockReturnValue({
    EMAIL_DISCOVERY_ENABLED: false,
  }),
}));

vi.mock('@signalforge/email', () => ({
  verifyEmailFull: vi.fn(),
}));

vi.mock('./activity.js', () => ({
  logDiscoveryActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./adapters/registry.js', () => ({
  getAdapter: vi.fn(),
  isFileBased: () => false,
}));

import { prisma } from '@signalforge/database';
import { verifyEmailFull } from '@signalforge/email';
import { getAdapter } from './adapters/registry.js';
import { runDiscoveryJob } from './pipeline.js';
import type { RawDiscoveredLead, LeadSourceAdapter } from './types.js';

const db = prisma as unknown as {
  leadDiscoveryJob: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  lead: { findMany: ReturnType<typeof vi.fn> };
  iCPProfile: { findUnique: ReturnType<typeof vi.fn> };
  discoveredLead: { upsert: ReturnType<typeof vi.fn> };
};

const mockGetAdapter = vi.mocked(getAdapter);
const mockVerifyEmail = vi.mocked(verifyEmailFull);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    workspaceId: 'ws-1',
    source: 'GOOGLE_MAPS_SCRAPER',
    status: 'PENDING',
    startedAt: null,
    query: {
      keywords: ['coffee shops'],
      city: 'Austin',
      state: 'Texas',
      country: 'United States',
      maxResults: 50,
    },
    filters: {},
    ...overrides,
  };
}

function makeLead(overrides: Partial<RawDiscoveredLead> = {}): RawDiscoveredLead {
  return {
    company: "Joe's Coffee",
    phone: '+15125551234',
    email: 'joe@joescoffee.com',
    website: 'https://joescoffee.com',
    industry: 'Coffee Shop',
    country: 'United States',
    countryCode: 'US',
    state: 'Texas',
    city: 'Austin',
    postalCode: '78701',
    sourceId: 'ChIJ123',
    sourceUrl: 'https://maps.google.com/?cid=123',
    fullName: 'Joe Smith',
    jobTitle: 'Owner',
    emailSource: 'SOURCE_PROVIDED' as never,
    metadata: { reviewRating: 4.5, reviewCount: 42 },
    ...overrides,
  };
}

function makeAdapter(leads: RawDiscoveredLead[]): LeadSourceAdapter {
  return {
    source: 'GOOGLE_MAPS_SCRAPER' as never,
    displayName: 'Google Maps (self-hosted scraper)',
    billable: false,
    isConfigured: () => true,
    search: vi.fn().mockResolvedValue({
      leads,
      appliedFilters: ['keywords', 'location'],
      requestsUsed: 1,
    }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Pipeline integration — Google Maps Scraper', () => {
  let upsertSeq: number;

  beforeEach(() => {
    vi.clearAllMocks();
    upsertSeq = 0;

    db.leadDiscoveryJob.findFirst.mockResolvedValue(makeJob());
    db.leadDiscoveryJob.update.mockResolvedValue({});
    db.lead.findMany.mockResolvedValue([]);
    db.iCPProfile.findUnique.mockResolvedValue(null);
    db.discoveredLead.upsert.mockImplementation(async () => {
      upsertSeq += 1;
      return { id: `dl-${upsertSeq}` };
    });
    mockVerifyEmail.mockResolvedValue({ status: 'VALID', score: 100 } as never);
  });

  it('processes 3 distinct leads through normalize → dedup → verify → qualify → persist', async () => {
    const leads = [
      makeLead({ company: "Joe's Coffee", sourceId: 'ChIJ001', email: 'joe@joescoffee.com', phone: '+15125551001', website: 'https://joescoffee.com' }),
      makeLead({ company: 'Tea House', sourceId: 'ChIJ002', email: 'info@teahouse.com', phone: '+15125551002', website: 'https://teahouse.com' }),
      makeLead({ company: 'Bean Counter', sourceId: 'ChIJ003', email: 'hello@beancounter.com', phone: '+15125551003', website: 'https://beancounter.com' }),
    ];
    mockGetAdapter.mockReturnValue(makeAdapter(leads));

    const result = await runDiscoveryJob({ jobId: 'job-1', workspaceId: 'ws-1' });

    expect(result.status).toBe('COMPLETED');
    expect(result.discovered).toBe(3);
    expect(result.unique).toBe(3);
    expect(result.duplicates).toBe(0);
    expect(result.emailsFound).toBe(3);
    expect(result.failed).toBe(0);
    expect(db.discoveredLead.upsert).toHaveBeenCalledTimes(3);
    expect(mockVerifyEmail).toHaveBeenCalledTimes(3);
  });

  it('deduplicates within-batch leads sharing the same phone number', async () => {
    const sharedPhone = '+15125559999';
    const leads = [
      makeLead({ company: 'Branch A', sourceId: 'ChIJ010', phone: sharedPhone, email: 'a@brancha.com', website: 'https://brancha.com' }),
      makeLead({ company: 'Other Biz', sourceId: 'ChIJ011', phone: '+15125551111', email: 'info@other.com', website: 'https://other.com' }),
      makeLead({ company: 'Branch B', sourceId: 'ChIJ012', phone: sharedPhone, email: 'b@branchb.com', website: 'https://branchb.com' }),
    ];
    mockGetAdapter.mockReturnValue(makeAdapter(leads));

    const result = await runDiscoveryJob({ jobId: 'job-1', workspaceId: 'ws-1' });

    expect(result.unique).toBe(2);
    expect(result.duplicates).toBe(1);
    expect(result.discovered).toBe(3);

    const upsertCalls = db.discoveredLead.upsert.mock.calls;
    const duplicateCall = upsertCalls.find(
      (call: unknown[]) => (call[0] as Record<string, Record<string, unknown>>).create?.isDuplicate === true,
    );
    expect(duplicateCall).toBeDefined();
  });

  it('allows no-email leads through without discarding or false verification', async () => {
    const leads = [
      makeLead({
        company: 'Phone Only Biz',
        sourceId: 'ChIJ020',
        email: null,
        emailSource: null,
        phone: '+15125552222',
        website: 'https://phoneonly.com',
      }),
    ];
    mockGetAdapter.mockReturnValue(makeAdapter(leads));

    const result = await runDiscoveryJob({ jobId: 'job-1', workspaceId: 'ws-1' });

    expect(result.unique).toBe(1);
    expect(result.emailsFound).toBe(0);
    expect(result.emailsVerified).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockVerifyEmail).not.toHaveBeenCalled();

    const upsertArg = db.discoveredLead.upsert.mock.calls[0]![0] as Record<string, Record<string, unknown>>;
    expect(upsertArg.create!.emailStatus).toBeNull();
    expect(upsertArg.create!.emailScore).toBeNull();
  });

  it('completes successfully with zero results from adapter', async () => {
    mockGetAdapter.mockReturnValue(makeAdapter([]));

    const result = await runDiscoveryJob({ jobId: 'job-1', workspaceId: 'ws-1' });

    expect(result.status).toBe('COMPLETED');
    expect(result.discovered).toBe(0);
    expect(result.unique).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.failed).toBe(0);
    expect(db.discoveredLead.upsert).not.toHaveBeenCalled();
  });

  it('marks job FAILED and re-throws when adapter throws', async () => {
    const adapter = makeAdapter([]);
    vi.mocked(adapter.search).mockRejectedValue(new Error('PROVIDER_UNAVAILABLE'));
    mockGetAdapter.mockReturnValue(adapter);

    await expect(
      runDiscoveryJob({ jobId: 'job-1', workspaceId: 'ws-1' }),
    ).rejects.toThrow('PROVIDER_UNAVAILABLE');

    const failedUpdate = db.leadDiscoveryJob.update.mock.calls.find(
      (call: unknown[]) => (call[0] as Record<string, Record<string, unknown>>).data?.status === 'FAILED',
    );
    expect(failedUpdate).toBeDefined();
  });

  it('uses upsert keyed on jobId + source + sourceId for idempotency', async () => {
    const leads = [
      makeLead({ company: 'Repeat Biz', sourceId: 'ChIJ030', email: 'repeat@biz.com', phone: '+15125553333', website: 'https://repeatbiz.com' }),
    ];
    mockGetAdapter.mockReturnValue(makeAdapter(leads));

    await runDiscoveryJob({ jobId: 'job-1', workspaceId: 'ws-1' });

    expect(db.discoveredLead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          jobId_source_sourceId: {
            jobId: 'job-1',
            source: 'GOOGLE_MAPS_SCRAPER',
            sourceId: 'ChIJ030',
          },
        },
      }),
    );
  });

  it('reports PARTIAL status when some leads fail to persist', async () => {
    const leads = [
      makeLead({ company: 'Good 1', sourceId: 'ChIJ040', email: 'a@good1.com', phone: '+15125554001', website: 'https://good1.com' }),
      makeLead({ company: 'Bad Lead', sourceId: 'ChIJ041', email: 'b@bad.com', phone: '+15125554002', website: 'https://bad.com' }),
      makeLead({ company: 'Good 2', sourceId: 'ChIJ042', email: 'c@good2.com', phone: '+15125554003', website: 'https://good2.com' }),
    ];
    mockGetAdapter.mockReturnValue(makeAdapter(leads));

    let callIdx = 0;
    db.discoveredLead.upsert.mockImplementation(async () => {
      callIdx += 1;
      if (callIdx === 2) throw new Error('DB constraint violation');
      return { id: `dl-${callIdx}` };
    });

    const result = await runDiscoveryJob({ jobId: 'job-1', workspaceId: 'ws-1' });

    expect(result.status).toBe('PARTIAL');
    expect(result.unique).toBe(2);
    expect(result.failed).toBe(1);
  });
});
