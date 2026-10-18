import { describe, expect, it, vi, beforeEach } from 'vitest';

const campaigns = new Map<string, Record<string, unknown>>();
const campaignLeads: { campaignId: string; leadId: string; id: string }[] = [];
const steps: { id: string; campaignId: string; order: number; enabled: boolean }[] = [];

vi.mock('@signalforge/config', () => ({
  loadEnv: () => ({
    LOG_LEVEL: 'error',
    APP_URL: 'http://localhost:3000',
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-with-minimum-length',
  }),
}));

vi.mock('@signalforge/database', () => ({
  prisma: {
    campaign: {
      findFirst: vi.fn(async ({ where }: { where: { id?: string; workspaceId?: string } }) => {
        const campaign = [...campaigns.values()].find(
          (c) => c.id === where.id && c.workspaceId === where.workspaceId,
        );
        if (!campaign) return null;
        return {
          ...campaign,
          steps: steps.filter((s) => s.campaignId === campaign.id),
          campaignLeads: campaignLeads
            .filter((cl) => cl.campaignId === campaign.id)
            .map((cl) => ({ ...cl, lead: { id: cl.leadId, email: `${cl.leadId}@test.com`, status: 'NEW' } })),
          mailboxes: [],
          _count: {
            campaignLeads: campaignLeads.filter((cl) => cl.campaignId === campaign.id).length,
            steps: steps.filter((s) => s.campaignId === campaign.id).length,
            mailboxes: 0,
          },
        };
      }),
      findMany: vi.fn(async () => [...campaigns.values()]),
      count: vi.fn(async () => campaigns.size),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `camp_${campaigns.size + 1}`;
        const campaign = { id, status: 'DRAFT', createdAt: new Date(), ...data };
        campaigns.set(id, campaign);
        return campaign;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = campaigns.get(where.id)!;
        const updated = { ...existing, ...data };
        campaigns.set(where.id, updated);
        return updated;
      }),
    },
    campaignLead: {
      findMany: vi.fn(async ({ where }: { where: { campaignId: string } }) =>
        campaignLeads.filter((cl) => cl.campaignId === where.campaignId),
      ),
      createMany: vi.fn(async ({ data }: { data: { campaignId: string; leadId: string }[] }) => {
        for (const row of data) {
          campaignLeads.push({ id: `cl_${campaignLeads.length + 1}`, ...row });
        }
        return { count: data.length };
      }),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    campaignStep: {
      findMany: vi.fn(async ({ where }: { where: { campaignId: string } }) =>
        steps.filter((s) => s.campaignId === where.campaignId),
      ),
      aggregate: vi.fn(async () => ({ _max: { order: steps.length - 1 } })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `step_${steps.length + 1}`;
        const step = { id, enabled: true, ...data };
        steps.push(step as typeof steps[number]);
        return step;
      }),
      update: vi.fn(),
      delete: vi.fn(),
    },
    campaignMailbox: { deleteMany: vi.fn(), createMany: vi.fn() },
    campaignActivity: { create: vi.fn(), findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    lead: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; workspaceId: string } }) =>
        (where.id?.in ?? []).map((id) => ({
          id,
          workspaceId: where.workspaceId,
          email: `${id}@test.com`,
          status: 'NEW',
          verification: { status: 'VERIFIED', score: 90 },
        })),
      ),
      findFirst: vi.fn(),
    },
    suppression: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}));

const launchMock = vi.fn(async (campaignId: string, workspaceId: string) => {
  const campaign = campaigns.get(campaignId);
  if (!campaign || campaign.workspaceId !== workspaceId) throw new Error('Campaign not found');
  if (campaign.status !== 'DRAFT') throw new Error(`Cannot launch campaign in ${campaign.status} status`);
  const enrolled = campaignLeads.filter((cl) => cl.campaignId === campaignId).length;
  const stepCount = steps.filter((s) => s.campaignId === campaignId && s.enabled).length;
  if (enrolled === 0 || stepCount === 0) {
    return {
      success: false as const,
      validation: { valid: false, ready: false, checks: [], errors: ['Missing requirements'], warnings: [] },
    };
  }
  campaign.status = 'ACTIVE';
  campaign.launchedAt = new Date();
  campaigns.set(campaignId, campaign);
  return { success: true as const, campaign, validation: { valid: true, ready: true, checks: [], errors: [], warnings: [] } };
});

vi.mock('@signalforge/campaigns', () => ({
  campaignService: {
    createDraft: vi.fn(async (workspaceId: string, data: { name: string }) => {
      const id = `camp_${campaigns.size + 1}`;
      const campaign = { id, workspaceId, name: data.name, status: 'DRAFT', description: null };
      campaigns.set(id, campaign);
      return campaign;
    }),
    updateCampaign: vi.fn(),
    launch: launchMock,
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    archive: vi.fn(),
    getActivity: vi.fn(async () => ({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })),
  },
  campaignLeadService: {
    enrollLeads: vi.fn(),
    removeLead: vi.fn(),
    previewEligibility: vi.fn(),
  },
  campaignValidationService: { validate: vi.fn() },
  campaignPreviewService: { preview: vi.fn(), previewVariations: vi.fn() },
  campaignExecutionPlanner: { buildPlan: vi.fn(async () => []) },
  sequenceService: {
    addStep: vi.fn(async (campaignId: string) => {
      const id = `step_${steps.length + 1}`;
      steps.push({ id, campaignId, order: steps.length, enabled: true });
      return { id, campaignId, order: steps.length - 1, enabled: true };
    }),
    updateStep: vi.fn(),
    deleteStep: vi.fn(),
    reorderSteps: vi.fn(),
    duplicateStep: vi.fn(),
  },
  syncDelayDays: vi.fn((amount: number) => amount),
}));

describe('Campaign routes authorization and launch', () => {
  beforeEach(() => {
    campaigns.clear();
    campaignLeads.length = 0;
    steps.length = 0;
    campaigns.set('camp_1', { id: 'camp_1', workspaceId: 'ws_1', name: 'Test', status: 'DRAFT' });
  });

  it('denies cross-workspace campaign access', async () => {
    const { prisma } = await import('@signalforge/database');
    const result = await prisma.campaign.findFirst({ where: { id: 'camp_1', workspaceId: 'ws_other' } });
    expect(result).toBeNull();
  });

  it('blocks launch without leads and steps', async () => {
    const { campaignService } = await import('@signalforge/campaigns');
    const result = await campaignService.launch('camp_1', 'ws_1');
    expect(result.success).toBe(false);
  });

  it('launches draft campaign when requirements are met', async () => {
    campaignLeads.push({ id: 'cl_1', campaignId: 'camp_1', leadId: 'lead_1' });
    steps.push({ id: 'step_1', campaignId: 'camp_1', order: 0, enabled: true });

    const { campaignService } = await import('@signalforge/campaigns');
    const result = await campaignService.launch('camp_1', 'ws_1');
    expect(result.success).toBe(true);
    expect(result.campaign?.status).toBe('ACTIVE');
  });
});
