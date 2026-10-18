import { prisma } from '@signalforge/database';
import type { Prisma } from '@signalforge/database';

import type { NormalizedLead } from './normalization.js';
import { loadIcpProfile, qualifyLead } from './qualification.js';

export interface RequalifyInput {
  workspaceId: string;
  jobId?: string;
  discoveredLeadIds?: string[];
  minScore?: number;
}

export interface RequalifyResult {
  requalified: number;
  newlyQualified: number;
  newlyDisqualified: number;
  unchanged: number;
}

const BATCH_SIZE = 200;

export async function requalifyLeads(input: RequalifyInput): Promise<RequalifyResult> {
  const { workspaceId, jobId, discoveredLeadIds, minScore = 0 } = input;

  const icp = await loadIcpProfile(workspaceId);

  const where: Prisma.DiscoveredLeadWhereInput = { workspaceId };
  if (jobId) where.jobId = jobId;
  if (discoveredLeadIds?.length) where.id = { in: discoveredLeadIds };

  let requalified = 0;
  let newlyQualified = 0;
  let newlyDisqualified = 0;
  let unchanged = 0;
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.discoveredLead.findMany({
      where,
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      const lead: NormalizedLead = {
        company: row.company,
        normalizedCompany: row.normalizedCompany ?? null,
        firstName: row.firstName,
        lastName: row.lastName,
        fullName: row.fullName,
        jobTitle: row.jobTitle,
        email: row.email,
        normalizedEmail: row.normalizedEmail ?? null,
        phone: row.phone,
        normalizedPhone: row.normalizedPhone ?? null,
        website: row.website,
        normalizedDomain: row.normalizedDomain ?? null,
        industry: row.industry,
        country: row.country,
        countryCode: row.countryCode,
        state: row.state,
        city: row.city,
        postalCode: row.postalCode,
        employeeCount: row.employeeCount,
        sourceId: row.sourceId,
        sourceUrl: row.sourceUrl,
      };

      const outcome = qualifyLead(lead, icp, {
        verificationStatus: (row.emailStatus ?? null) as never,
        verificationScore: row.emailScore ?? null,
        hasWebsiteAnalysis: row.websiteScore != null,
        websiteScore: row.websiteScore ?? null,
        opportunityScore: row.opportunityScore ?? null,
      }, minScore);

      const wasQualified = row.qualified;
      const nowQualified = outcome.qualified;

      await prisma.discoveredLead.update({
        where: { id: row.id },
        data: {
          icpFitScore: outcome.prospectScore,
          icpBreakdown: outcome.breakdown as Prisma.InputJsonValue,
          qualified: outcome.qualified,
          qualifyReason: outcome.reason,
          qualificationVersion: outcome.version,
          qualificationSignals: outcome.signals as unknown as Prisma.InputJsonValue,
        },
      });

      requalified += 1;
      if (!wasQualified && nowQualified) newlyQualified += 1;
      else if (wasQualified && !nowQualified) newlyDisqualified += 1;
      else unchanged += 1;
    }

    cursor = rows[rows.length - 1]!.id;
    if (rows.length < BATCH_SIZE) break;
  }

  return { requalified, newlyQualified, newlyDisqualified, unchanged };
}
