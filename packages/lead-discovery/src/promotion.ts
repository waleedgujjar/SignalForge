/// Promotion of staged discovery rows into canonical Leads.
///
/// This is the only place the discovery engine writes to the `Lead` table, and
/// it is where multi-source merging actually happens: a business already known
/// to the workspace is UPDATED (filling gaps, never overwriting existing data)
/// and gains another `LeadSourceRecord`, rather than becoming a duplicate lead.
///
/// `Lead.email` is required by the schema, so a staged row with no email cannot
/// be promoted. Those rows are reported as skipped with a clear reason rather
/// than being given a synthetic address, which would poison the sending engine.

import { prisma } from '@signalforge/database';
import type { DiscoverySourceType, Prisma } from '@signalforge/database';
import { emailVerificationService } from '@signalforge/verification';
import { publishWorkflowEvent } from '@signalforge/queue';

import { logDiscoveryActivity } from './activity.js';

export interface PromotionResult {
  promoted: number;
  created: number;
  updated: number;
  skipped: Array<{ discoveredLeadId: string; reason: string }>;
  leadIds: string[];
}

/// Only fill a canonical field when it is currently empty. Discovery data is
/// weaker evidence than whatever the user or a paid enrichment already stored.
function fillGaps(
  existing: Record<string, unknown>,
  incoming: Record<string, string | null | undefined>,
): Prisma.LeadUpdateInput {
  const update: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || value === '') continue;
    const current = existing[key];
    if (current == null || current === '') update[key] = value;
  }
  return update as Prisma.LeadUpdateInput;
}

export async function promoteDiscoveredLeads(input: {
  workspaceId: string;
  discoveredLeadIds: string[];
  actorUserId?: string | null;
  jobId?: string | null;
}): Promise<PromotionResult> {
  const rows = await prisma.discoveredLead.findMany({
    where: { id: { in: input.discoveredLeadIds }, workspaceId: input.workspaceId },
  });

  const result: PromotionResult = { promoted: 0, created: 0, updated: 0, skipped: [], leadIds: [] };

  for (const row of rows) {
    if (row.promotedLeadId) {
      // Already promoted — re-running must not create a second lead.
      result.skipped.push({ discoveredLeadId: row.id, reason: 'Already saved' });
      continue;
    }

    const email = row.normalizedEmail ?? row.email;
    if (!email) {
      result.skipped.push({
        discoveredLeadId: row.id,
        reason: 'No email address — run email discovery, or add one before saving',
      });
      continue;
    }

    const incoming = {
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: row.fullName,
      company: row.company,
      companyDomain: row.normalizedDomain,
      jobTitle: row.jobTitle,
      industry: row.industry,
      phone: row.normalizedPhone ?? row.phone,
      countryCode: row.countryCode,
      country: row.country,
      state: row.state,
      city: row.city,
      website: row.website,
    };

    const existing = await prisma.lead.findUnique({
      where: { workspaceId_email: { workspaceId: input.workspaceId, email } },
    });

    let leadId: string;
    if (existing) {
      const update = fillGaps(existing as unknown as Record<string, unknown>, incoming);
      if (Object.keys(update).length > 0) {
        await prisma.lead.update({ where: { id: existing.id }, data: update });
      }
      leadId = existing.id;
      result.updated += 1;
    } else {
      const created = await prisma.lead.create({
        data: {
          workspaceId: input.workspaceId,
          email,
          source: 'DISCOVERY',
          ...Object.fromEntries(Object.entries(incoming).filter(([, v]) => v != null && v !== '')),
        } as Prisma.LeadUncheckedCreateInput,
      });
      leadId = created.id;
      result.created += 1;
    }

    // Source provenance. The unique constraint on (leadId, source, sourceId)
    // makes a repeated promotion a no-op rather than a duplicate row.
    await prisma.leadSourceRecord.upsert({
      where: {
        leadId_source_sourceId: {
          leadId,
          source: row.source as DiscoverySourceType,
          sourceId: row.sourceId ?? '',
        },
      },
      create: {
        workspaceId: input.workspaceId,
        leadId,
        source: row.source,
        sourceId: row.sourceId ?? '',
        sourceUrl: row.sourceUrl,
        jobId: row.jobId,
        discoveredAt: row.discoveredAt,
      },
      update: {},
    });

    // Carry full verification onto the canonical lead so campaign eligibility
    // can see it without re-verifying.
    if (email) {
      await emailVerificationService.verifyAndPersist(email, {
        workspaceId: input.workspaceId,
        leadId,
        options: { workspaceId: input.workspaceId },
      });
    }

    await prisma.discoveredLead.update({
      where: { id: row.id },
      data: { promotedLeadId: leadId, stage: 'READY' },
    });

    result.promoted += 1;
    result.leadIds.push(leadId);

    const websiteUrl = row.website || row.normalizedDomain;
    if (websiteUrl) {
      const { enqueueWebsiteAnalysisForLead } = await import('./enqueue-website-analysis.js');
      void enqueueWebsiteAnalysisForLead(input.workspaceId, leadId).catch(() => {});
    }

    void publishWorkflowEvent({
      eventType: 'LEAD_IMPORTED',
      workspaceId: input.workspaceId,
      leadId,
      idempotencyKey: `discovery-promoted:${row.id}`,
      metadata: { source: row.source, discoveryJobId: row.jobId },
    }).catch(() => {});
  }

  if (result.promoted > 0) {
    await logDiscoveryActivity({
      workspaceId: input.workspaceId,
      jobId: input.jobId ?? null,
      actorUserId: input.actorUserId ?? null,
      type: 'LEADS_SAVED',
      summary: `Saved ${result.promoted} lead(s) — ${result.created} new, ${result.updated} merged into existing`,
      metadata: { skipped: result.skipped.length },
    });
  }

  return result;
}
