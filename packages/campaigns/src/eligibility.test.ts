import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldExcludeByVerification, VERIFICATION_VERSION } from '@signalforge/email';

const db = vi.hoisted(() => ({
  leads: [] as Array<Record<string, unknown>>,
  enrolled: [] as Array<{ leadId: string }>,
  suppressions: [] as Array<{ type: string; value: string; reason: string }>,
  workspacePolicy: null as Record<string, unknown> | null,
  duplicatePolicy: 'WARN',
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock('@signalforge/database', () => ({
  prisma: {
    campaign: {
      findFirst: vi.fn(async () => ({
        id: 'c1',
        status: 'DRAFT',
        verificationPolicy: null,
        suppressionPolicy: null,
        duplicateEnrollmentPolicy: db.duplicatePolicy,
      })),
    },
    workspaceVerificationPolicy: { findFirst: vi.fn(async () => db.workspacePolicy) },
    lead: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } }; select?: unknown }) =>
        db.leads.filter((l) => args.where.id.in.includes(l.id as string)),
      ),
    },
    campaignLead: {
      findMany: vi.fn(async () => db.enrolled),
      createMany: vi.fn(async (args: { data: Array<Record<string, unknown>> }) => {
        db.created.push(...args.data);
        return { count: args.data.length };
      }),
    },
    suppression: { findMany: vi.fn(async () => db.suppressions) },
    campaignActivity: { create: vi.fn(async () => ({})) },
  },
}));
vi.mock('./activity.js', () => ({ logCampaignActivity: vi.fn(async () => undefined) }));

const { campaignEligibilityService } = await import('./eligibility.js');
const { campaignLeadService } = await import('./campaign-lead-service.js');

function lead(id: string, status: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@acme.com`,
    status: 'NEW',
    verification:
      status === null
        ? null
        : {
            status,
            score: status === 'VERIFIED' ? 95 : status === 'INVALID' ? 0 : 60,
            riskScore: status === 'VERIFIED' ? 0 : status === 'INVALID' ? 100 : 10,
            riskLevel: status === 'INVALID' ? 'VERY_HIGH' : 'LOW',
            reason: null,
            reasonCode: status === 'UNKNOWN' ? 'SMTP_UNAVAILABLE' : null,
            verifiedAt: new Date(),
            verificationVersion: VERIFICATION_VERSION,
            ...extra,
          },
  };
}

beforeEach(() => {
  db.leads = [
    lead('valid', 'VERIFIED'),
    lead('invalid', 'INVALID'),
    lead('unknown', 'UNKNOWN'),
    lead('catchall', 'CATCH_ALL'),
    lead('never', null),
    lead('old', 'VERIFIED', { verifiedAt: new Date(Date.now() - 30 * 24 * 3600 * 1000) }),
  ];
  db.enrolled = [];
  db.suppressions = [];
  db.workspacePolicy = null;
  db.duplicatePolicy = 'WARN';
  db.created = [];
});

describe('campaign eligibility', () => {
  it('sorts leads into eligible, review and not-eligible with per-lead verification', async () => {
    const report = await campaignEligibilityService.checkLeadsBulk('ws', 'c1', db.leads.map((l) => l.id as string));
    const byId = new Map(report.leads.map((r) => [r.leadId, r]));

    expect(byId.get('valid')).toMatchObject({ eligible: true, verification: { tier: 'ELIGIBLE', stale: false } });
    expect(byId.get('invalid')).toMatchObject({ eligible: false, reviewable: false, reasons: ['INVALID_EMAIL'] });
    expect(byId.get('unknown')).toMatchObject({ eligible: false, reviewable: true, reasons: ['UNKNOWN_EMAIL'] });
    expect(byId.get('catchall')).toMatchObject({ eligible: false, reviewable: true, reasons: ['CATCH_ALL_EMAIL'] });
    // Unverified is blocked by default, the same as at send time.
    expect(byId.get('never')).toMatchObject({ eligible: false, reviewable: false, reasons: ['UNVERIFIED_EMAIL'] });
    expect(report.leads.map((r) => r.leadId)).toEqual(['valid', 'invalid', 'unknown', 'catchall', 'never', 'old']);
    expect(report.counts.review).toBe(2);
    expect(report.needsVerification).toEqual(['never', 'old']);
    expect(byId.get('old')?.verification?.stale).toBe(true);
  });

  it('lets a reviewer approve review-tier leads but never invalid or unverified ones', async () => {
    const report = await campaignEligibilityService.checkLeadsBulk('ws', 'c1', ['unknown', 'catchall', 'invalid', 'never'], {
      approvedLeadIds: ['unknown', 'catchall', 'invalid', 'never'],
    });
    const eligible = report.eligible.map((r) => r.leadId).sort();
    expect(eligible).toEqual(['catchall', 'unknown']);
    expect(report.eligible.every((r) => r.reviewApproved)).toBe(true);
  });

  it('does not let approval override suppression', async () => {
    db.suppressions = [{ type: 'EMAIL', value: 'unknown@acme.com', reason: 'UNSUBSCRIBED' }];
    const report = await campaignEligibilityService.checkLeadsBulk('ws', 'c1', ['unknown'], { approvedLeadIds: ['unknown'] });
    expect(report.eligible).toHaveLength(0);
    expect(report.leads[0]!.reasons).toContain('SUPPRESSED');
  });
});

describe('campaign enrollment', () => {
  it('enrolls only eligible leads by default and records approvals', async () => {
    const result = await campaignLeadService.enrollLeads('c1', 'ws', ['valid', 'invalid', 'unknown'], {
      actorUserId: 'u1',
      approvedLeadIds: ['unknown'],
    });
    expect(result.enrolled).toBe(2);
    expect(db.created).toEqual([
      { campaignId: 'c1', leadId: 'valid' },
      { campaignId: 'c1', leadId: 'unknown', verificationApprovedAt: expect.any(Date), verificationApprovedById: 'u1' },
    ]);
  });

  it('does not bypass verification or suppression under the ALLOW duplicate policy', async () => {
    db.duplicatePolicy = 'ALLOW';
    db.suppressions = [{ type: 'EMAIL', value: 'valid@acme.com', reason: 'BOUNCED' }];
    const result = await campaignLeadService.enrollLeads('c1', 'ws', ['valid', 'invalid', 'never']);
    expect(result.enrolled).toBe(0);
    expect(db.created).toEqual([]);
  });
});

describe('shouldExcludeByVerification', () => {
  it('allows a verified lead and blocks a missing result by default', () => {
    expect(shouldExcludeByVerification({ status: 'VERIFIED', score: 95, riskScore: 0, riskLevel: 'LOW' }, {}).excluded).toBe(false);
    expect(shouldExcludeByVerification(null, {}).excluded).toBe(true);
  });
});
