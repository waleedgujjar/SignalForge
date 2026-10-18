import { describe, expect, it, vi, beforeEach } from 'vitest';

const { checkLeadsBulkMock } = vi.hoisted(() => ({
  checkLeadsBulkMock: vi.fn(),
}));

vi.mock('@signalforge/database', () => ({
  prisma: {
    campaign: {
      findFirst: vi.fn(),
    },
    lead: {
      findMany: vi.fn(async () => []),
    },
    campaignLead: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    campaignActivity: {
      create: vi.fn(async () => ({})),
    },
    suppression: {
      findMany: vi.fn(async () => []),
    },
    workspaceVerificationPolicy: {
      findFirst: vi.fn(async () => null),
    },
  },
}));

vi.mock('../eligibility.js', () => ({
  campaignEligibilityService: {
    checkLeadsBulk: checkLeadsBulkMock,
  },
  CampaignEligibilityService: vi.fn(),
}));

vi.mock('../activity.js', () => ({
  logCampaignActivity: vi.fn(async () => ({})),
}));

import { prisma } from '@signalforge/database';
import { ENROLLABLE_STATUSES } from '../campaign-lead-service.js';
import { CampaignLeadService } from '../campaign-lead-service.js';

const service = new CampaignLeadService();

function mockCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 'camp_1',
    workspaceId: 'ws_1',
    status: 'ACTIVE',
    duplicateEnrollmentPolicy: 'BLOCK',
    ...overrides,
  };
}

function mockEligibility(
  eligible: string[] = [],
  ineligible: Array<{ leadId: string; reasons: string[] }> = [],
  alreadyEnrolled: string[] = [],
) {
  return {
    eligible: eligible.map((id) => ({ leadId: id })),
    ineligible: ineligible.map((r) => ({ leadId: r.leadId, reasons: r.reasons })),
    alreadyEnrolled: alreadyEnrolled.map((id) => ({ leadId: id })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Campaign Integration — Enrollment', () => {
  it('enrolls eligible leads into an ACTIVE campaign', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValueOnce(mockCampaign() as never);
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([{ id: 'lead_1' }] as never);
    checkLeadsBulkMock.mockResolvedValueOnce(mockEligibility(['lead_1']));
    vi.mocked(prisma.campaignLead.createMany).mockResolvedValueOnce({ count: 1 } as never);

    const result = await service.enrollLeads('camp_1', 'ws_1', ['lead_1']);

    expect(result.enrolled).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('blocks enrollment when campaign is COMPLETED', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValueOnce(
      mockCampaign({ status: 'COMPLETED' }) as never,
    );

    const result = await service.enrollLeads('camp_1', 'ws_1', ['lead_1']);

    expect(result.enrolled).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.blocked).toBe('CAMPAIGN_COMPLETED');
  });

  it('blocks enrollment when campaign is STOPPED', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValueOnce(
      mockCampaign({ status: 'STOPPED' }) as never,
    );

    const result = await service.enrollLeads('camp_1', 'ws_1', ['lead_1']);

    expect(result.blocked).toBe('CAMPAIGN_STOPPED');
  });

  it('blocks enrollment when campaign is ARCHIVED', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValueOnce(
      mockCampaign({ status: 'ARCHIVED' }) as never,
    );

    const result = await service.enrollLeads('camp_1', 'ws_1', ['lead_1']);

    expect(result.blocked).toBe('CAMPAIGN_ARCHIVED');
  });

  it('throws when campaign is not found', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValueOnce(null);

    await expect(service.enrollLeads('camp_x', 'ws_1', ['lead_1'])).rejects.toThrow(
      'Campaign not found',
    );
  });

  it('enforces workspace isolation — no cross-workspace enrollment', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValueOnce(null);

    await expect(
      service.enrollLeads('camp_1', 'ws_other', ['lead_1']),
    ).rejects.toThrow('Campaign not found');
  });

  it('skips leads that are already enrolled (BLOCK policy)', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValueOnce(mockCampaign() as never);
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce(
      [{ id: 'lead_1' }, { id: 'lead_2' }] as never,
    );
    checkLeadsBulkMock.mockResolvedValueOnce(
      mockEligibility(['lead_1'], [], ['lead_2']),
    );
    vi.mocked(prisma.campaignLead.createMany).mockResolvedValueOnce({ count: 1 } as never);

    const result = await service.enrollLeads('camp_1', 'ws_1', ['lead_1', 'lead_2']);

    expect(result.enrolled).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('skips leads missing an email', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValueOnce(mockCampaign() as never);
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([{ id: 'lead_1' }] as never);
    checkLeadsBulkMock.mockResolvedValueOnce(
      mockEligibility(
        [],
        [{ leadId: 'lead_1', reasons: ['MISSING_EMAIL'] }],
      ),
    );

    const result = await service.enrollLeads('camp_1', 'ws_1', ['lead_1']);

    expect(result.enrolled).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('skips suppressed leads', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValueOnce(mockCampaign() as never);
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([{ id: 'lead_1' }] as never);
    checkLeadsBulkMock.mockResolvedValueOnce(
      mockEligibility(
        [],
        [{ leadId: 'lead_1', reasons: ['SUPPRESSED'] }],
      ),
    );

    const result = await service.enrollLeads('camp_1', 'ws_1', ['lead_1']);

    expect(result.enrolled).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('permits enrollment into DRAFT, SCHEDULED, ACTIVE, PAUSED campaigns', () => {
    expect(ENROLLABLE_STATUSES.has('DRAFT')).toBe(true);
    expect(ENROLLABLE_STATUSES.has('SCHEDULED')).toBe(true);
    expect(ENROLLABLE_STATUSES.has('ACTIVE')).toBe(true);
    expect(ENROLLABLE_STATUSES.has('PAUSED')).toBe(true);
    expect(ENROLLABLE_STATUSES.has('COMPLETED')).toBe(false);
    expect(ENROLLABLE_STATUSES.has('STOPPED')).toBe(false);
    expect(ENROLLABLE_STATUSES.has('ARCHIVED')).toBe(false);
  });

  it('handles partial enrollment — mixed eligible and ineligible', async () => {
    vi.mocked(prisma.campaign.findFirst).mockResolvedValueOnce(mockCampaign() as never);
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce(
      [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }, { id: 'l4' }, { id: 'l5' }] as never,
    );
    checkLeadsBulkMock.mockResolvedValueOnce(
      mockEligibility(
        ['l1', 'l2'],
        [
          { leadId: 'l3', reasons: ['SUPPRESSED'] },
          { leadId: 'l4', reasons: ['MISSING_EMAIL'] },
        ],
        ['l5'],
      ),
    );
    vi.mocked(prisma.campaignLead.createMany).mockResolvedValueOnce({ count: 2 } as never);

    const result = await service.enrollLeads('camp_1', 'ws_1', ['l1', 'l2', 'l3', 'l4', 'l5']);

    expect(result.enrolled).toBe(2);
    expect(result.skipped).toBe(3);
  });
});

describe('Campaign Integration — Eligibility', () => {
  it('exports ENROLLABLE_STATUSES with the correct set', () => {
    expect(ENROLLABLE_STATUSES).toBeInstanceOf(Set);
    expect(ENROLLABLE_STATUSES.size).toBe(4);
  });
});
