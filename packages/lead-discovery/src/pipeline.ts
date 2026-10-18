/// The discovery pipeline.
///
/// DISCOVERED → NORMALIZED → DEDUPLICATED → EMAIL_CHECKED → QUALIFIED → READY
///
/// Enrichment stages that require network work on third-party sites
/// (WEBSITE_ANALYZED, EMAIL_DISCOVERED, AI_RESEARCHED) are Stage 2 and are
/// skipped here; the stage enum already carries them so the schema does not
/// change when they land.
///
/// Every step is idempotent and driven off persisted counters, so a retried
/// BullMQ job resumes rather than duplicating work.

import { getEnv } from '@signalforge/config';
import { prisma } from '@signalforge/database';
import type { DiscoverySourceType, Prisma } from '@signalforge/database';
import { verifyEmailFull } from '@signalforge/email';

import { logDiscoveryActivity } from './activity.js';
import { getAdapter, isFileBased } from './adapters/registry.js';
import { addToIndex, createDedupIndex, findDuplicate, toDedupEntry, type DedupEntry } from './dedup.js';
import { discoverEmailForLeads } from './email-discovery.js';
import { hasImportableRowData, hasUsableIdentity, normalizeEmail, normalizeLead, type NormalizedLead } from './normalization.js';
import { loadIcpProfile, qualifyLead } from './qualification.js';
import type { AdapterContext, LeadSearchParams } from './types.js';

/// Hard ceilings. Discovery must never fan out unboundedly: `createWorker`
/// pins BullMQ concurrency at 5, so throttling has to happen inside the job.
export const MAX_DISCOVERY_RESULTS = Number(process.env.MAX_DISCOVERY_RESULTS ?? 500);
export const MAX_EMAIL_VERIFY_CONCURRENCY = Number(process.env.MAX_EMAIL_VERIFY_CONCURRENCY ?? 5);

/// Run `worker` over `items` with at most `limit` in flight.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index] as T, index);
      }
    }),
  );

  return results;
}

/// Fetch only the existing leads that could possibly match this batch.
///
/// Loading every lead in the workspace would not scale past a few thousand;
/// this is one indexed query keyed on the batch's own identifiers.
export async function loadDedupCandidates(
  workspaceId: string,
  leads: NormalizedLead[],
): Promise<DedupEntry[]> {
  const emails = [...new Set(leads.map((l) => l.normalizedEmail).filter((v): v is string => !!v))];
  const domains = [...new Set(leads.map((l) => l.normalizedDomain).filter((v): v is string => !!v))];
  const phones = [...new Set(leads.map((l) => l.normalizedPhone).filter((v): v is string => !!v))];
  const cities = [...new Set(leads.map((l) => l.city).filter((v): v is string => !!v))];

  const or: Prisma.LeadWhereInput[] = [];
  if (emails.length) or.push({ email: { in: emails } });
  if (domains.length) or.push({ companyDomain: { in: domains } });
  if (phones.length) or.push({ phone: { in: phones } });
  // Company/fuzzy tiers only ever compare within the same city, so scoping the
  // fetch to those cities keeps the candidate set small but complete.
  if (cities.length) or.push({ city: { in: cities } });
  if (or.length === 0) return [];

  const existing = await prisma.lead.findMany({
    where: { workspaceId, OR: or },
    select: {
      id: true, email: true, companyDomain: true, phone: true,
      company: true, city: true, countryCode: true,
    },
    take: 5000,
  });

  return existing.map((lead) => {
    const normalized = normalizeLead({
      company: lead.company,
      email: lead.email,
      phone: lead.phone,
      website: lead.companyDomain,
      city: lead.city,
      countryCode: lead.countryCode,
    });
    return toDedupEntry(normalized, lead.id, null);
  });
}

/// Row-level requirements from the search form.
export function passesRequirements(lead: NormalizedLead, params: LeadSearchParams): string | null {
  if (params.requireWebsite && !lead.normalizedDomain) return 'no website';
  if (params.requirePhone && !lead.normalizedPhone) return 'no phone';
  if (params.requireEmail && !lead.normalizedEmail) return 'no email';
  return null;
}

export interface RunDiscoveryResult {
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  discovered: number;
  unique: number;
  duplicates: number;
  emailsFound: number;
  emailsVerified: number;
  qualified: number;
  failed: number;
}

export async function runDiscoveryJob(input: {
  jobId: string;
  workspaceId: string;
  file?: AdapterContext['file'];
}): Promise<RunDiscoveryResult> {
  const job = await prisma.leadDiscoveryJob.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
  });
  if (!job) throw new Error(`Discovery job ${input.jobId} not found`);

  if (job.status === 'CANCELLED') {
    return { status: 'COMPLETED', discovered: 0, unique: 0, duplicates: 0, emailsFound: 0, emailsVerified: 0, qualified: 0, failed: 0 };
  }

  const params = job.query as unknown as LeadSearchParams;
  const filters = (job.filters ?? {}) as { minScore?: number };
  const maxResults = Math.min(params.maxResults ?? 50, MAX_DISCOVERY_RESULTS);

  await prisma.leadDiscoveryJob.update({
    where: { id: job.id },
    data: { status: 'RUNNING', startedAt: job.startedAt ?? new Date(), error: null },
  });

  const errors: Array<{ stage: string; message: string }> = [];
  let failed = 0;

  try {
    // ── DISCOVERED ────────────────────────────────────────────────────────
    const adapter = getAdapter(job.source as DiscoverySourceType);
    const search = await adapter.search(
      { ...params, maxResults },
      { workspaceId: job.workspaceId, jobId: job.id, file: input.file },
    );

    // ── NORMALIZED ────────────────────────────────────────────────────────
    const fileImport = isFileBased(job.source as DiscoverySourceType);
    const normalized: NormalizedLead[] = [];
    for (const raw of search.leads) {
      const lead = normalizeLead(raw);
      if (fileImport) {
        // CSV/XLSX: import the user's data as-is; do not apply search filters.
        if (!hasImportableRowData(lead)) {
          failed += 1;
          continue;
        }
      } else {
        if (!hasUsableIdentity(lead)) {
          failed += 1;
          continue;
        }
        const missing = passesRequirements(lead, params);
        if (missing) {
          failed += 1;
          continue;
        }
      }
      normalized.push(lead);
    }

    // ── DEDUPLICATED ──────────────────────────────────────────────────────
    const existing = await loadDedupCandidates(job.workspaceId, normalized);
    const index = createDedupIndex(existing);
    const icp = await loadIcpProfile(job.workspaceId);
    const minScore = filters.minScore ?? params.minScore ?? 0;

    let unique = 0;
    let duplicates = 0;
    let emailsFound = 0;
    let emailsVerified = 0;
    let qualified = 0;

    // ── EMAIL_DISCOVERED ─────────────────────────────────────────────────
    const discoveredConfidence = new Map<string, number>();
    const env = getEnv();
    if (env.EMAIL_DISCOVERY_ENABLED) {
      const needsDiscovery = normalized.filter(
        (l) => !l.normalizedEmail && (l.normalizedDomain || l.website),
      );
      if (needsDiscovery.length > 0) {
        const discovered = await discoverEmailForLeads(needsDiscovery, {
          maxPages: env.EMAIL_DISCOVERY_MAX_PAGES,
          requestTimeoutMs: env.EMAIL_DISCOVERY_TIMEOUT_MS,
          maxConcurrency: env.EMAIL_DISCOVERY_MAX_CONCURRENCY,
        });
        for (const lead of needsDiscovery) {
          const domain = lead.normalizedDomain;
          if (!domain) continue;
          const result = discovered.get(domain);
          if (result) {
            lead.normalizedEmail = normalizeEmail(result.email);
            lead.email = result.email;
            lead.emailSource = result.source;
            if (lead.normalizedEmail) {
              discoveredConfidence.set(lead.normalizedEmail, result.confidence);
            }
          }
        }
      }
    }

    // Verify up front, bounded, so scoring can use real verification status.
    const verifiable = normalized.filter((l) => l.normalizedEmail);
    const verifications = new Map<string, { status: string; score: number }>();
    await mapWithConcurrency(verifiable, MAX_EMAIL_VERIFY_CONCURRENCY, async (lead) => {
      if (!lead.normalizedEmail) return;
      try {
        const result = await verifyEmailFull(lead.normalizedEmail, { workspaceId: job.workspaceId });
        verifications.set(lead.normalizedEmail, { status: result.status, score: result.score });
      } catch {
        // Verification is advisory; a DNS hiccup must not fail the lead.
      }
    });

    for (const lead of normalized) {
      const entry = toDedupEntry(lead, `pending:${unique + duplicates}`, job.source);
      const match = findDuplicate(entry, index);

      if (lead.normalizedEmail) emailsFound += 1;
      const verification = lead.normalizedEmail ? verifications.get(lead.normalizedEmail) : undefined;
      if (verification) emailsVerified += 1;

      const outcome = qualifyLead(lead, icp, {
        verificationStatus: (verification?.status ?? null) as never,
        verificationScore: verification?.score ?? null,
        hasWebsiteAnalysis: false,
      }, minScore);

      if (outcome.qualified) qualified += 1;

      try {
        const created = await prisma.discoveredLead.upsert({
          where: {
            jobId_source_sourceId: {
              jobId: job.id,
              source: job.source,
              sourceId: lead.sourceId ?? `${lead.normalizedEmail ?? lead.normalizedDomain ?? lead.normalizedCompany ?? 'row'}`,
            },
          },
          create: {
            workspaceId: job.workspaceId,
            jobId: job.id,
            source: job.source,
            sourceId: lead.sourceId ?? `${lead.normalizedEmail ?? lead.normalizedDomain ?? lead.normalizedCompany ?? 'row'}`,
            sourceUrl: lead.sourceUrl ?? null,
            stage: match ? 'DEDUPLICATED' : 'QUALIFIED',
            isDuplicate: Boolean(match),
            duplicateOfId: match?.id ?? null,
            matchReason: match?.reason ?? null,
            rawCompany: lead.company ?? null,
            rawEmail: lead.email ?? null,
            rawPhone: lead.phone ?? null,
            rawWebsite: lead.website ?? null,
            company: lead.company ?? null,
            normalizedCompany: lead.normalizedCompany,
            firstName: lead.firstName ?? null,
            lastName: lead.lastName ?? null,
            fullName: lead.fullName ?? null,
            jobTitle: lead.jobTitle ?? null,
            email: lead.normalizedEmail,
            normalizedEmail: lead.normalizedEmail,
            phone: lead.phone ?? null,
            normalizedPhone: lead.normalizedPhone,
            website: lead.website,
            normalizedDomain: lead.normalizedDomain,
            industry: lead.industry ?? null,
            countryCode: lead.countryCode ?? null,
            country: lead.country ?? null,
            state: lead.state ?? null,
            city: lead.city ?? null,
            postalCode: lead.postalCode ?? null,
            employeeCount: lead.employeeCount ?? null,
            emailSource: lead.emailSource ?? null,
            emailConfidence: discoveredConfidence.get(lead.normalizedEmail ?? '') ?? null,
            emailStatus: (verification?.status ?? null) as never,
            emailScore: verification?.score ?? null,
            icpFitScore: outcome.prospectScore,
            icpBreakdown: outcome.breakdown as Prisma.InputJsonValue,
            qualified: outcome.qualified,
            qualifyReason: outcome.reason,
            qualificationVersion: outcome.version,
            qualificationSignals: outcome.signals as unknown as Prisma.InputJsonValue,
          },
          // Re-running a job refreshes scoring without creating a second row.
          update: {
            icpFitScore: outcome.prospectScore,
            icpBreakdown: outcome.breakdown as Prisma.InputJsonValue,
            qualified: outcome.qualified,
            qualifyReason: outcome.reason,
            qualificationVersion: outcome.version,
            qualificationSignals: outcome.signals as unknown as Prisma.InputJsonValue,
            emailSource: lead.emailSource ?? null,
            emailConfidence: discoveredConfidence.get(lead.normalizedEmail ?? '') ?? null,
            emailStatus: (verification?.status ?? null) as never,
            emailScore: verification?.score ?? null,
          },
        });

        if (match) {
          duplicates += 1;
        } else {
          unique += 1;
          entry.id = created.id;
          addToIndex(index, entry);
        }
      } catch (error) {
        failed += 1;
        errors.push({ stage: 'persist', message: error instanceof Error ? error.message : String(error) });
      }
    }

    const status: RunDiscoveryResult['status'] = failed > 0 && unique === 0 ? 'FAILED' : failed > 0 ? 'PARTIAL' : 'COMPLETED';

    await prisma.leadDiscoveryJob.update({
      where: { id: job.id },
      data: {
        status,
        discoveredCount: search.leads.length,
        uniqueCount: unique,
        duplicateCount: duplicates,
        emailsFoundCount: emailsFound,
        emailsVerifiedCount: emailsVerified,
        qualifiedCount: qualified,
        failedCount: failed,
        completedAt: new Date(),
        errorLog: errors.slice(0, 50) as unknown as Prisma.InputJsonValue,
        metadata: {
          appliedFilters: search.appliedFilters,
          requestsUsed: search.requestsUsed,
          warnings: search.warnings ?? [],
        } as Prisma.InputJsonValue,
      },
    });

    await logDiscoveryActivity({
      workspaceId: job.workspaceId,
      jobId: job.id,
      type: status === 'FAILED' ? 'FAILED' : 'COMPLETED',
      summary: `Discovery ${status.toLowerCase()} — ${unique} unique, ${duplicates} duplicate, ${qualified} qualified`,
      metadata: { discovered: search.leads.length, failed },
    });

    return {
      status,
      discovered: search.leads.length,
      unique,
      duplicates,
      emailsFound,
      emailsVerified,
      qualified,
      failed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.leadDiscoveryJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', error: message, completedAt: new Date() },
    });
    await logDiscoveryActivity({
      workspaceId: job.workspaceId,
      jobId: job.id,
      type: 'FAILED',
      summary: `Discovery failed: ${message}`,
    });
    throw error;
  }
}
