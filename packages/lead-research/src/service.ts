/// Database-layer service for lead research.
///
/// Every query is scoped by workspaceId. This module never calls providers
/// directly — the worker + LinkedInResearchService handle that; this is the
/// read/write layer the API routes and worker use to manage research records,
/// provider configs, and the unified history.

import { createHash } from 'node:crypto';

import { prisma, Prisma } from '@signalforge/database';
import type { LeadResearch, ResearchProviderConfig } from '@signalforge/database';
import type { Env } from '@signalforge/config';

import {
  ResearchNotFoundError,
  InvalidResearchStateError,
  type ManualVerificationInput,
  type UnifiedHistoryItem,
  type ResearchStats,
  type ProviderStatusEntry,
  type ProviderUsage,
  type ResearchProvenanceEntry,
} from './types.js';
import type { LinkedInProviderName, ProviderHealth, ProviderDescriptor } from './linkedin/types.js';
import { parseLinkedInUrl } from './linkedin/url.js';
import { DEFAULT_PROVIDER_WORKSPACE_ENABLED } from './linkedin/registry.js';
import { sanitizeSecrets } from './sanitize.js';

// ─── Service ────────────────────────────────────────────────────────────────

export class LeadResearchService {
  // ─── Create ─────────────────────────────────────────────────────────────

  async createResearchRequests(input: {
    workspaceId: string;
    leadId: string;
    requestedByUserId: string | null;
    companyUrl?: string;
    personUrl?: string;
    forceRefresh?: boolean;
  }): Promise<{ research: LeadResearch[]; queued: number; reused: number }> {
    const results: LeadResearch[] = [];
    let reused = 0;

    const urls: Array<{ url: string; expectedType: 'COMPANY' | 'PERSON' }> = [];
    if (input.companyUrl) urls.push({ url: input.companyUrl, expectedType: 'COMPANY' });
    if (input.personUrl) urls.push({ url: input.personUrl, expectedType: 'PERSON' });

    for (const { url, expectedType } of urls) {
      const parsed = parseLinkedInUrl(url);
      if (!parsed.ok) {
        const { LinkedInUrlError } = await import('./types.js');
        throw new LinkedInUrlError(parsed.code, parsed.message);
      }
      if (parsed.value.researchType !== expectedType) {
        const { LinkedInUrlError } = await import('./types.js');
        throw new LinkedInUrlError(
          'UNSUPPORTED_URL',
          `Expected a ${expectedType.toLowerCase()} URL but got a ${parsed.value.kind.toLowerCase()} URL`,
        );
      }

      const existing = await prisma.leadResearch.findFirst({
        where: {
          workspaceId: input.workspaceId,
          leadId: input.leadId,
          source: 'LINKEDIN',
          researchType: parsed.value.researchType,
          normalizedUrl: parsed.value.normalizedUrl,
          status: { in: ['PENDING', 'QUEUED', 'IN_PROGRESS'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing && !input.forceRefresh) {
        if (existing.status === 'PENDING') {
          const updated = await prisma.leadResearch.update({
            where: { id: existing.id },
            data: { status: 'QUEUED', requestedByUserId: input.requestedByUserId },
          });
          results.push(updated);
        } else {
          results.push(existing);
        }
        reused++;
      } else {
        const created = await prisma.leadResearch.create({
          data: {
            workspaceId: input.workspaceId,
            leadId: input.leadId,
            source: 'LINKEDIN',
            researchType: parsed.value.researchType,
            sourceUrl: parsed.value.sourceUrl,
            normalizedUrl: parsed.value.normalizedUrl,
            status: 'QUEUED',
            requestedByUserId: input.requestedByUserId,
          },
        });
        results.push(created);
      }

      // Fill Lead.linkedinUrl if empty (person URLs only).
      if (parsed.value.kind === 'PERSON') {
        await prisma.lead.updateMany({
          where: { id: input.leadId, linkedinUrl: null },
          data: { linkedinUrl: parsed.value.normalizedUrl },
        });
      }
    }

    return { research: results, queued: results.filter((r) => r.status === 'QUEUED').length, reused };
  }

  // ─── Web Research ────────────────────────────────────────────────────────

  async createWebResearchRequests(input: {
    workspaceId: string;
    leadId: string;
    requestedByUserId: string | null;
    websiteUrl?: string;
    forceRefresh?: boolean;
  }): Promise<{ research: LeadResearch[]; queued: number; reused: number }> {
    let url = input.websiteUrl;

    if (!url) {
      const lead = await prisma.lead.findUnique({
        where: { id: input.leadId },
        select: { website: true, companyDomain: true },
      });
      url = lead?.website ?? (lead?.companyDomain ? `https://${lead.companyDomain}` : undefined) ?? undefined;
    }

    if (!url) {
      throw new Error('No website URL available for this lead');
    }

    try {
      new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      throw new Error(`Invalid website URL: ${url}`);
    }

    const normalizedUrl = this.normalizeWebUrl(url);

    const existing = await prisma.leadResearch.findFirst({
      where: {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        source: 'WEB',
        researchType: 'COMPANY',
        normalizedUrl,
        status: { in: ['PENDING', 'QUEUED', 'IN_PROGRESS'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing && !input.forceRefresh) {
      if (existing.status === 'PENDING') {
        const updated = await prisma.leadResearch.update({
          where: { id: existing.id },
          data: { status: 'QUEUED', requestedByUserId: input.requestedByUserId },
        });
        return { research: [updated], queued: 1, reused: 0 };
      }
      return { research: [existing], queued: 0, reused: 1 };
    }

    const created = await prisma.leadResearch.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        source: 'WEB',
        researchType: 'COMPANY',
        sourceUrl: url,
        normalizedUrl,
        status: 'QUEUED',
        requestedByUserId: input.requestedByUserId,
      },
    });

    return { research: [created], queued: 1, reused: 0 };
  }

  private normalizeWebUrl(url: string): string {
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      parsed.search = '';
      parsed.hash = '';
      const path = parsed.pathname.replace(/\/+$/, '') || '/';
      return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path}`;
    } catch {
      return url.toLowerCase();
    }
  }

  async createSuggestions(
    inputs: Array<{ workspaceId: string; leadId: string; companyUrl?: string; personUrl?: string }>,
  ): Promise<number> {
    let created = 0;

    for (const input of inputs) {
      const urls: Array<{ url: string; expectedType: 'COMPANY' | 'PERSON' }> = [];
      if (input.companyUrl) urls.push({ url: input.companyUrl, expectedType: 'COMPANY' });
      if (input.personUrl) urls.push({ url: input.personUrl, expectedType: 'PERSON' });

      for (const { url, expectedType } of urls) {
        const parsed = parseLinkedInUrl(url);
        if (!parsed.ok) continue;
        if (parsed.value.researchType !== expectedType) continue;

        const existing = await prisma.leadResearch.findFirst({
          where: {
            workspaceId: input.workspaceId,
            leadId: input.leadId,
            source: 'LINKEDIN',
            researchType: parsed.value.researchType,
            normalizedUrl: parsed.value.normalizedUrl,
          },
        });
        if (existing) continue;

        await prisma.leadResearch.create({
          data: {
            workspaceId: input.workspaceId,
            leadId: input.leadId,
            source: 'LINKEDIN',
            researchType: parsed.value.researchType,
            sourceUrl: parsed.value.sourceUrl,
            normalizedUrl: parsed.value.normalizedUrl,
            status: 'PENDING',
          },
        });
        created++;
      }
    }

    return created;
  }

  // ─── Approve ────────────────────────────────────────────────────────────

  async approvePending(input: {
    workspaceId: string;
    researchIds?: string[];
    leadIds?: string[];
    limit: number;
  }): Promise<{ rows: Array<{ id: string; leadId: string; source: string }>; skipped: number; capped: boolean }> {
    const where: Prisma.LeadResearchWhereInput = {
      workspaceId: input.workspaceId,
      status: 'PENDING',
      OR: [
        ...(input.researchIds?.length ? [{ id: { in: input.researchIds } }] : []),
        ...(input.leadIds?.length ? [{ leadId: { in: input.leadIds } }] : []),
      ],
    };
    if (!where.OR || (where.OR as unknown[]).length === 0) delete where.OR;

    const pending = await prisma.leadResearch.findMany({
      where,
      select: { id: true, leadId: true, source: true },
      orderBy: { createdAt: 'asc' },
      take: input.limit + 1,
    });

    const capped = pending.length > input.limit;
    const toApprove = pending.slice(0, input.limit);
    const ids = toApprove.map((r) => r.id);

    if (ids.length > 0) {
      await prisma.leadResearch.updateMany({
        where: { id: { in: ids }, workspaceId: input.workspaceId, status: 'PENDING' },
        data: { status: 'QUEUED' },
      });
    }

    return {
      rows: toApprove.map((r) => ({ id: r.id, leadId: r.leadId, source: r.source })),
      skipped: 0,
      capped,
    };
  }

  // ─── Worker lifecycle ───────────────────────────────────────────────────

  async markInProgress(researchId: string): Promise<void> {
    await prisma.leadResearch.update({
      where: { id: researchId },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
  }

  async persistOutcome(researchId: string, update: Record<string, unknown>): Promise<void> {
    const data: Prisma.LeadResearchUpdateInput = {
      status: update.status as Prisma.LeadResearchUpdateInput['status'],
      provider: (update.provider as string) ?? undefined,
      confidence: update.confidence as Prisma.LeadResearchUpdateInput['confidence'],
      summary: (update.summary as string) ?? undefined,
      structuredData: update.structuredData !== undefined
        ? (update.structuredData === null ? Prisma.DbNull : update.structuredData as Prisma.InputJsonValue)
        : undefined,
      provenance: update.provenance !== undefined
        ? (update.provenance === null ? Prisma.DbNull : update.provenance as Prisma.InputJsonValue)
        : undefined,
      rawData: update.rawData !== undefined
        ? (update.rawData === null ? Prisma.DbNull : update.rawData as Prisma.InputJsonValue)
        : undefined,
      errorCode: update.errorCode !== undefined ? (update.errorCode as string | null) : undefined,
      errorMessage: update.errorMessage !== undefined ? (update.errorMessage as string | null) : undefined,
      completedAt: update.completedAt !== undefined ? (update.completedAt as Date) : undefined,
      inputHash: update.inputHash !== undefined ? (update.inputHash as string) : undefined,
    };
    await prisma.leadResearch.update({ where: { id: researchId }, data });
  }

  async persistFailure(
    researchId: string,
    errorCode: string,
    errorMessage: string,
    provider: string | null,
  ): Promise<void> {
    await prisma.leadResearch.update({
      where: { id: researchId },
      data: {
        status: 'FAILED',
        errorCode,
        errorMessage: sanitizeSecrets(errorMessage),
        provider: provider ?? undefined,
        completedAt: new Date(),
      },
    });
  }

  async incrementProviderCounters(
    workspaceId: string,
    source: string,
    provider: string,
    kind: 'success' | 'failed' | 'manual_review',
  ): Promise<void> {
    const increment: Prisma.ResearchProviderConfigUpdateInput = {
      requestCount: { increment: 1 },
      lastUsedAt: new Date(),
    };
    if (kind === 'success') increment.successfulRequests = { increment: 1 };
    else if (kind === 'failed') increment.failedRequests = { increment: 1 };
    else if (kind === 'manual_review') increment.manualReviewCount = { increment: 1 };

    await prisma.researchProviderConfig.upsert({
      where: {
        workspaceId_source_provider: { workspaceId, source: source as never, provider },
      },
      create: {
        workspaceId,
        source: source as never,
        provider,
        enabled: DEFAULT_PROVIDER_WORKSPACE_ENABLED[provider as LinkedInProviderName] ?? false,
        requestCount: 1,
        successfulRequests: kind === 'success' ? 1 : 0,
        failedRequests: kind === 'failed' ? 1 : 0,
        manualReviewCount: kind === 'manual_review' ? 1 : 0,
        lastUsedAt: new Date(),
        periodStart: new Date(),
      },
      update: increment,
    });
  }

  // ─── Provider configs ───────────────────────────────────────────────────

  async getProviderConfigs(workspaceId: string): Promise<ResearchProviderConfig[]> {
    return prisma.researchProviderConfig.findMany({ where: { workspaceId } });
  }

  resolveWorkspaceEnabled(
    configs: ResearchProviderConfig[],
  ): (name: LinkedInProviderName) => boolean {
    return (name: LinkedInProviderName): boolean => {
      const config = configs.find((c) => c.provider === name);
      if (config) return config.enabled;
      return DEFAULT_PROVIDER_WORKSPACE_ENABLED[name] ?? false;
    };
  }

  async recordHealthCheck(
    workspaceId: string,
    source: string,
    health: ProviderHealth,
  ): Promise<void> {
    await prisma.researchProviderConfig.upsert({
      where: {
        workspaceId_source_provider: { workspaceId, source: source as never, provider: health.provider },
      },
      create: {
        workspaceId,
        source: source as never,
        provider: health.provider,
        enabled: DEFAULT_PROVIDER_WORKSPACE_ENABLED[health.provider as LinkedInProviderName] ?? false,
        lastHealthCheckAt: new Date(health.checkedAt),
        lastHealthStatus: health.status,
        periodStart: new Date(),
      },
      update: {
        lastHealthCheckAt: new Date(health.checkedAt),
        lastHealthStatus: health.status,
      },
    });
  }

  async upsertProviderConfig(input: {
    workspaceId: string;
    source: string;
    provider: string;
    enabled: boolean;
  }): Promise<void> {
    await prisma.researchProviderConfig.upsert({
      where: {
        workspaceId_source_provider: {
          workspaceId: input.workspaceId,
          source: input.source as never,
          provider: input.provider,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        source: input.source as never,
        provider: input.provider,
        enabled: input.enabled,
        periodStart: new Date(),
      },
      update: { enabled: input.enabled },
    });
  }

  buildProviderStatusEntries(input: {
    descriptors: ProviderDescriptor[];
    configs: ResearchProviderConfig[];
    env: Env;
    healthByProvider?: Record<string, ProviderHealth>;
  }): ProviderStatusEntry[] {
    const isEnabled = this.resolveWorkspaceEnabled(input.configs);

    return input.descriptors.map((descriptor): ProviderStatusEntry => {
      const config = input.configs.find((c) => c.provider === descriptor.provider);
      const health = input.healthByProvider?.[descriptor.provider];
      const usage: ProviderUsage | null = config
        ? {
            requestCount: config.requestCount,
            successfulRequests: config.successfulRequests,
            failedRequests: config.failedRequests,
            manualReviewCount: config.manualReviewCount,
            lastUsedAt: config.lastUsedAt?.toISOString() ?? null,
            lastHealthCheckAt: config.lastHealthCheckAt?.toISOString() ?? null,
            lastHealthStatus: config.lastHealthStatus,
          }
        : null;

      const enabled = isEnabled(descriptor.provider as LinkedInProviderName);

      // Status resolution: fresh health > persisted health > descriptor state.
      let status: ProviderStatusEntry['status'];
      let authentication: ProviderStatusEntry['authentication'];
      let checkedAt: string;
      let details: string[];

      if (health) {
        status = !enabled ? 'DISABLED' : health.status;
        authentication = health.authentication;
        checkedAt = health.checkedAt;
        details = health.details;
      } else if (config?.lastHealthStatus) {
        status = !enabled ? 'DISABLED' : (config.lastHealthStatus as ProviderStatusEntry['status']);
        authentication = descriptor.configured ? 'CONFIGURED' : 'NOT_CONFIGURED';
        checkedAt = config.lastHealthCheckAt?.toISOString() ?? new Date().toISOString();
        details = [];
      } else {
        if (!descriptor.implemented) status = 'UNAVAILABLE';
        else if (!enabled) status = 'DISABLED';
        else if (!descriptor.configured) status = 'NEEDS_SETUP';
        else status = 'READY';
        authentication = descriptor.configured
          ? 'CONFIGURED'
          : (descriptor.provider === 'public' ? 'NOT_REQUIRED' : 'NOT_CONFIGURED');
        checkedAt = new Date().toISOString();
        details = [];
      }

      return {
        provider: descriptor.provider,
        displayName: descriptor.displayName,
        status,
        authentication,
        checkedAt,
        details,
        implemented: descriptor.implemented,
        note: descriptor.note,
        enabled,
        usage,
      };
    });
  }

  // ─── Reads ──────────────────────────────────────────────────────────────

  async getLatestPerSource(workspaceId: string, leadId: string): Promise<LeadResearch[]> {
    const rows = await prisma.leadResearch.findMany({
      where: { workspaceId, leadId },
      orderBy: { createdAt: 'desc' },
    });
    const seen = new Map<string, LeadResearch>();
    for (const row of rows) {
      const key = `${row.source}:${row.researchType}`;
      if (!seen.has(key)) seen.set(key, row);
    }
    return [...seen.values()];
  }

  async getUnifiedHistory(workspaceId: string, leadId: string): Promise<UnifiedHistoryItem[]> {
    const items: UnifiedHistoryItem[] = [];

    const research = await prisma.leadResearch.findMany({
      where: { workspaceId, leadId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    for (const row of research) {
      items.push({
        id: row.id,
        date: (row.completedAt ?? row.createdAt).toISOString(),
        source: row.source as UnifiedHistoryItem['source'],
        type: row.researchType,
        status: row.status,
        provider: row.provider,
        confidence: row.confidence,
        sourceUrl: row.normalizedUrl ?? row.sourceUrl,
        href: `/leads/${leadId}`,
      });
    }

    const websiteAnalyses = await prisma.websiteAnalysis.findMany({
      where: { workspaceId, leadId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        analyzedAt: true,
        createdAt: true,
        url: true,
      },
    });
    for (const wa of websiteAnalyses) {
      items.push({
        id: wa.id,
        date: (wa.analyzedAt ?? wa.createdAt).toISOString(),
        source: 'WEBSITE',
        type: 'WEBSITE',
        status: wa.status,
        provider: 'website-scanner',
        confidence: null,
        sourceUrl: wa.url,
        href: `/website-intelligence/${wa.id}`,
      });
    }

    const verifications = await prisma.emailVerificationHistory.findMany({
      where: { workspaceId, leadId },
      orderBy: { checkedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        verificationMethod: true,
        checkedAt: true,
      },
    });
    for (const v of verifications) {
      items.push({
        id: v.id,
        date: v.checkedAt.toISOString(),
        source: 'EMAIL_VERIFICATION',
        type: 'EMAIL',
        status: v.status,
        provider: v.verificationMethod,
        confidence: null,
        sourceUrl: null,
        href: `/leads/${leadId}`,
      });
    }

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items.slice(0, 200);
  }

  async getResearch(workspaceId: string, id: string): Promise<(LeadResearch & { activities: unknown[] }) | null> {
    return prisma.leadResearch.findFirst({
      where: { id, workspaceId },
      include: {
        activities: { take: 20, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  // ─── Manual verification ────────────────────────────────────────────────

  async applyManualVerification(input: {
    workspaceId: string;
    researchId: string;
    userId: string;
    input: ManualVerificationInput;
  }): Promise<LeadResearch> {
    const row = await prisma.leadResearch.findFirst({
      where: { id: input.researchId, workspaceId: input.workspaceId },
    });
    if (!row) throw new ResearchNotFoundError(input.researchId);
    if (row.status === 'IN_PROGRESS') {
      throw new InvalidResearchStateError('Cannot verify a research record that is currently in progress');
    }

    const now = new Date();
    const existingData = (row.structuredData as Record<string, unknown>) ?? {};
    const manualInput = input.input;
    const sourceUrl =
      manualInput.person?.profileUrl ?? manualInput.company?.url ?? row.normalizedUrl ?? null;

    const mergedData: Record<string, unknown> = { ...existingData };
    if (manualInput.person) {
      mergedData.person = { ...((existingData.person as Record<string, unknown>) ?? {}), ...manualInput.person };
    }
    if (manualInput.company) {
      mergedData.company = { ...((existingData.company as Record<string, unknown>) ?? {}), ...manualInput.company };
    }
    if (manualInput.signals) {
      mergedData.signals = { ...((existingData.signals as Record<string, unknown>) ?? {}), ...manualInput.signals };
    }

    // Carry over existing provenance entries, upgrading each to VERIFIED.
    const existingProvenance = Array.isArray(row.provenance)
      ? (row.provenance as unknown as ResearchProvenanceEntry[])
      : [];
    const verifiedExisting = existingProvenance.map((entry) => ({
      ...entry,
      verification: 'VERIFIED' as const,
    }));

    // Build new MANUAL/VERIFIED entries for the manually supplied fields.
    const manualEntries: ResearchProvenanceEntry[] = [];
    const addEntry = (field: string, value: unknown) => {
      if (value === undefined || value === null || value === '') return;
      manualEntries.push({
        field,
        value,
        source: 'MANUAL',
        sourceUrl,
        provider: 'manual',
        retrievedAt: now.toISOString(),
        confidence: 1.0,
        verification: 'VERIFIED',
      });
    };

    if (manualInput.person) {
      if (manualInput.person.firstName) addEntry('person.firstName', manualInput.person.firstName);
      if (manualInput.person.lastName) addEntry('person.lastName', manualInput.person.lastName);
      if (manualInput.person.title) addEntry('person.title', manualInput.person.title);
      if (manualInput.person.profileUrl) addEntry('person.profileUrl', manualInput.person.profileUrl);
    }
    if (manualInput.company) {
      if (manualInput.company.name) addEntry('company.name', manualInput.company.name);
      if (manualInput.company.url) addEntry('company.url', manualInput.company.url);
      if (manualInput.company.industry) addEntry('company.industry', manualInput.company.industry);
      if (manualInput.company.location) addEntry('company.location', manualInput.company.location);
      if (manualInput.company.employeeRange) addEntry('company.employeeRange', manualInput.company.employeeRange);
    }
    if (manualInput.signals) {
      if (manualInput.signals.decisionMaker != null) addEntry('signals.decisionMaker', manualInput.signals.decisionMaker);
      if (manualInput.signals.hiring != null) addEntry('signals.hiring', manualInput.signals.hiring);
      if (manualInput.signals.growthSignal != null) addEntry('signals.growthSignal', manualInput.signals.growthSignal);
      if (manualInput.signals.technologySignal != null) addEntry('signals.technologySignal', manualInput.signals.technologySignal);
    }

    const provenance = [...verifiedExisting, ...manualEntries];

    const rawData = manualInput.notes
      ? { ...((row.rawData as Record<string, unknown> | null) ?? {}), manualNotes: manualInput.notes }
      : row.rawData;

    const updated = await prisma.leadResearch.update({
      where: { id: input.researchId },
      data: {
        status: 'COMPLETED',
        provider: 'manual',
        confidence: 'HIGH',
        verifiedAt: now,
        verifiedByUserId: input.userId,
        structuredData: mergedData as Prisma.InputJsonValue,
        provenance: provenance as unknown as Prisma.InputJsonValue,
        rawData: rawData as Prisma.InputJsonValue ?? Prisma.DbNull,
        completedAt: now,
        summary: this.buildManualSummary(mergedData),
      },
    });

    await this.fillLeadGaps(row.leadId, {
      jobTitle: manualInput.person?.title,
      linkedinUrl: manualInput.person?.profileUrl,
      firstName: manualInput.person?.firstName,
      lastName: manualInput.person?.lastName,
    });

    return updated;
  }

  async markVerified(input: {
    workspaceId: string;
    researchId: string;
    userId: string;
  }): Promise<LeadResearch> {
    const row = await prisma.leadResearch.findFirst({
      where: { id: input.researchId, workspaceId: input.workspaceId },
    });
    if (!row) throw new ResearchNotFoundError(input.researchId);
    if (row.status !== 'COMPLETED' && row.status !== 'PARTIAL') {
      throw new InvalidResearchStateError(
        `Cannot mark as verified: record is ${row.status}, must be COMPLETED or PARTIAL`,
      );
    }

    const existingProvenance = Array.isArray(row.provenance)
      ? (row.provenance as unknown as ResearchProvenanceEntry[])
      : [];
    const updatedProvenance = existingProvenance.map((entry) => ({
      ...entry,
      verification: 'VERIFIED' as const,
    }));

    return prisma.leadResearch.update({
      where: { id: input.researchId },
      data: {
        verifiedAt: new Date(),
        verifiedByUserId: input.userId,
        confidence: 'HIGH',
        provenance: updatedProvenance as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async resetForRetry(input: {
    workspaceId: string;
    researchId: string;
  }): Promise<{ id: string; leadId: string; source: string; retryCount: number }> {
    const row = await prisma.leadResearch.findFirst({
      where: { id: input.researchId, workspaceId: input.workspaceId },
      select: { id: true, leadId: true, source: true, status: true, retryCount: true },
    });
    if (!row) throw new ResearchNotFoundError(input.researchId);
    if (row.status !== 'FAILED' && row.status !== 'UNAVAILABLE' && row.status !== 'MANUAL_REVIEW') {
      throw new InvalidResearchStateError(
        `Cannot retry: record is ${row.status}, must be FAILED, UNAVAILABLE or MANUAL_REVIEW`,
      );
    }

    await prisma.leadResearch.update({
      where: { id: row.id },
      data: {
        status: 'QUEUED',
        errorCode: null,
        errorMessage: null,
        retryCount: { increment: 1 },
      },
    });

    return { id: row.id, leadId: row.leadId, source: row.source, retryCount: row.retryCount + 1 };
  }

  // ─── Stats ──────────────────────────────────────────────────────────────

  async getStats(workspaceId: string): Promise<ResearchStats> {
    const rows = await prisma.leadResearch.findMany({
      where: { workspaceId },
      select: { status: true, researchType: true, verifiedAt: true, completedAt: true },
    });

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let verifiedCount = 0;
    let completedLast7Days = 0;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      byType[row.researchType] = (byType[row.researchType] ?? 0) + 1;
      if (row.verifiedAt) verifiedCount++;
      if (row.completedAt && row.completedAt >= sevenDaysAgo && (row.status === 'COMPLETED' || row.status === 'PARTIAL')) {
        completedLast7Days++;
      }
    }

    const configs = await this.getProviderConfigs(workspaceId);
    const providers = configs.map((config) => ({
      provider: config.provider,
      source: config.source,
      enabled: config.enabled,
      requestCount: config.requestCount,
      successfulRequests: config.successfulRequests,
      failedRequests: config.failedRequests,
      manualReviewCount: config.manualReviewCount,
      lastUsedAt: config.lastUsedAt?.toISOString() ?? null,
      lastHealthCheckAt: config.lastHealthCheckAt?.toISOString() ?? null,
      lastHealthStatus: config.lastHealthStatus,
    }));

    return {
      total: rows.length,
      byStatus: byStatus as ResearchStats['byStatus'],
      byType: byType as ResearchStats['byType'],
      manualReviewCount: byStatus['MANUAL_REVIEW'] ?? 0,
      pendingCount: byStatus['PENDING'] ?? 0,
      verifiedCount,
      completedLast7Days,
      providers,
    };
  }

  // ─── Queue listing ──────────────────────────────────────────────────────

  async listQueue(
    workspaceId: string,
    options: {
      statuses: string[];
      source?: string;
      researchType?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: string;
      page: number;
      limit: number;
    },
  ): Promise<{ data: unknown[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const where: Prisma.LeadResearchWhereInput = {
      workspaceId,
      status: { in: options.statuses as never[] },
    };
    if (options.source) where.source = options.source as never;
    if (options.researchType) where.researchType = options.researchType as never;
    if (options.search) {
      where.OR = [
        { lead: { email: { contains: options.search, mode: 'insensitive' } } },
        { lead: { fullName: { contains: options.search, mode: 'insensitive' } } },
        { lead: { company: { contains: options.search, mode: 'insensitive' } } },
      ];
    }

    const orderBy: Prisma.LeadResearchOrderByWithRelationInput = {};
    const sortField = options.sortBy ?? 'createdAt';
    const sortDir = options.sortOrder === 'asc' ? 'asc' : 'desc';
    orderBy[sortField as keyof Prisma.LeadResearchOrderByWithRelationInput] = sortDir as never;

    const [total, rows] = await Promise.all([
      prisma.leadResearch.count({ where }),
      prisma.leadResearch.findMany({
        where,
        orderBy,
        skip: (options.page - 1) * options.limit,
        take: options.limit,
        select: {
          id: true,
          workspaceId: true,
          leadId: true,
          source: true,
          researchType: true,
          sourceUrl: true,
          normalizedUrl: true,
          status: true,
          provider: true,
          confidence: true,
          summary: true,
          errorCode: true,
          errorMessage: true,
          requestedByUserId: true,
          verifiedAt: true,
          retryCount: true,
          createdAt: true,
          updatedAt: true,
          completedAt: true,
          lead: {
            select: {
              id: true,
              email: true,
              fullName: true,
              company: true,
              website: true,
              city: true,
              industry: true,
              jobTitle: true,
              linkedinUrl: true,
            },
          },
        },
      }),
    ]);

    return {
      data: rows,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.ceil(total / options.limit),
      },
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  computeInputHash(
    research: { normalizedUrl?: string | null; sourceUrl?: string | null; researchType: string },
    providerNames: string[],
  ): string {
    const payload = JSON.stringify({
      normalizedUrl: research.normalizedUrl ?? null,
      sourceUrl: research.sourceUrl ?? null,
      researchType: research.researchType,
      providers: providerNames.sort(),
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  async fillLeadGaps(
    leadId: string,
    data: { jobTitle?: string; linkedinUrl?: string; firstName?: string; lastName?: string },
  ): Promise<void> {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, jobTitle: true, linkedinUrl: true, firstName: true, lastName: true },
    });
    if (!lead) return;

    const updates: Prisma.LeadUpdateInput = {};
    if (data.jobTitle && !lead.jobTitle) updates.jobTitle = data.jobTitle;
    if (data.linkedinUrl && !lead.linkedinUrl) updates.linkedinUrl = data.linkedinUrl;
    if (data.firstName && !lead.firstName) updates.firstName = data.firstName;
    if (data.lastName && !lead.lastName) updates.lastName = data.lastName;

    if (Object.keys(updates).length > 0) {
      await prisma.lead.update({ where: { id: leadId }, data: updates });
    }
  }

  private buildManualSummary(data: Record<string, unknown>): string {
    const parts: string[] = [];
    const person = data.person as Record<string, unknown> | undefined;
    const company = data.company as Record<string, unknown> | undefined;
    if (person?.fullName || person?.firstName) {
      let line = (person.fullName ?? `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim()) as string;
      if (person.title) line += ` — ${person.title}`;
      parts.push(line);
    }
    if (company?.name) {
      const bits = [company.name, company.industry, company.employeeRange, company.location].filter(Boolean);
      parts.push(bits.join(' · '));
    }
    return parts.join(' | ').slice(0, 500) || 'Manual verification';
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const leadResearchService = new LeadResearchService();
