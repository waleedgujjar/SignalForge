import { prisma } from '@signalforge/database';
import { loadEnv, type Env } from '@signalforge/config';
import { publishWorkflowEvent } from '@signalforge/automations';
import type { LeadResearchQueuePayload } from '@signalforge/queue';
import type { LeadResearchSource, LeadResearchType } from '@signalforge/database';
import {
  LinkedInResearchService,
  leadResearchService,
  selectProviderChain,
  mapOutcomeToRecordUpdate,
  logResearchActivity,
  ensureEnrichmentQueued,
  RETRYABLE_ERROR_CODES,
  type ResearchErrorCode,
  type ResearchRecordUpdate,
  type ChainRunResult,
  WebResearchService,
  selectWebProviderChain,
  mapWebOutcomeToRecordUpdate,
  type WebChainRunResult,
} from '@signalforge/lead-research';

import { logResearch, sanitizeLogMessage } from './log.js';

export type LeadResearchJobData = LeadResearchQueuePayload;

export interface JobMeta {
  attemptsMade: number;
  maxAttempts: number;
}

export interface ProcessorDeps {
  service?: LinkedInResearchService;
  env?: () => Env;
  now?: () => Date;
}

export interface ProcessorResult {
  researchId: string;
  status: string;
  reason?: string;
}

/// Thrown only for TIMEOUT / PROVIDER_UNAVAILABLE while attempts remain, so
/// BullMQ retries with backoff. Every other failure is persisted and returned
/// normally — a provider refusal must never turn into a retry storm.
export class RetryableResearchError extends Error {
  constructor(
    public readonly code: ResearchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RetryableResearchError';
  }
}

interface ResearchRow {
  id: string;
  leadId: string;
  normalizedUrl: string | null;
  sourceUrl: string | null;
  researchType: LeadResearchType;
  lead: { company: string | null; fullName: string | null };
}

interface SourceConfig {
  enabled: boolean;
  label: string;
  chainProviderNames: string[];
  execute(
    research: ResearchRow,
    env: Env,
    workspaceId: string,
    deps: ProcessorDeps,
  ): Promise<ChainRunResult | WebChainRunResult>;
  mapOutcome(
    run: ChainRunResult | WebChainRunResult,
    completedAt: Date,
  ): ResearchRecordUpdate & { completedAt: Date };
}

function resolveSourceConfig(
  source: LeadResearchSource,
  _researchType: LeadResearchType,
  env: Env,
): SourceConfig | null {
  switch (source) {
    case 'LINKEDIN': {
      const chain = selectProviderChain(env);
      const svc = new LinkedInResearchService();
      return {
        enabled: env.LINKEDIN_RESEARCH_ENABLED,
        label: 'LinkedIn',
        chainProviderNames: chain.map((p) => p.name),
        async execute(research, _env, workspaceId, deps) {
          const service = deps.service ?? svc;
          return service.run(
            {
              id: research.id,
              workspaceId,
              leadId: research.leadId,
              researchType: research.researchType,
              normalizedUrl: research.normalizedUrl,
              sourceUrl: research.sourceUrl,
            },
            { company: research.lead.company, fullName: research.lead.fullName },
            chain,
            env.LINKEDIN_RESEARCH_TIMEOUT_MS,
          );
        },
        mapOutcome: mapOutcomeToRecordUpdate,
      };
    }

    case 'WEB': {
      const chain = selectWebProviderChain(env);
      const svc = new WebResearchService();
      return {
        enabled: env.WEB_RESEARCH_ENABLED,
        label: 'Web',
        chainProviderNames: chain.map((p) => p.name),
        async execute(research, _env, workspaceId) {
          return svc.run(
            {
              id: research.id,
              workspaceId,
              leadId: research.leadId,
              normalizedUrl: research.normalizedUrl,
              sourceUrl: research.sourceUrl,
            },
            { company: research.lead.company, domain: research.normalizedUrl },
            chain,
            _env.WEB_RESEARCH_TIMEOUT_MS,
          );
        },
        mapOutcome: mapWebOutcomeToRecordUpdate,
      };
    }

    default:
      return null;
  }
}

export async function processLeadResearchJob(
  data: LeadResearchJobData,
  meta: JobMeta,
  deps: ProcessorDeps = {},
): Promise<ProcessorResult> {
  const env = (deps.env ?? loadEnv)();
  const now = deps.now ?? (() => new Date());
  const { workspaceId, leadId, researchId } = data;

  // 1. Load + tenancy assert: the where-clause includes workspaceId, so a row
  //    from another workspace can never be loaded, let alone processed.
  const research = await prisma.leadResearch.findFirst({
    where: { id: researchId, workspaceId },
    include: {
      lead: { select: { id: true, workspaceId: true, company: true, fullName: true, jobTitle: true } },
    },
  });

  if (!research) {
    logResearch('research_skipped', { researchId, leadId, workspaceId, status: 'NOT_FOUND' });
    return { researchId, status: 'SKIPPED', reason: 'NOT_FOUND' };
  }

  if (research.lead.workspaceId !== workspaceId || research.leadId !== leadId) {
    await leadResearchService.persistFailure(
      researchId,
      'WORKSPACE_MISMATCH',
      'Research row does not belong to the lead/workspace in the job payload',
      null,
    );
    logResearch('research_failed', { researchId, leadId, workspaceId, status: 'FAILED', errorCode: 'WORKSPACE_MISMATCH' });
    return { researchId, status: 'FAILED', reason: 'WORKSPACE_MISMATCH' };
  }

  if (research.status === 'COMPLETED' && !data.forceRefresh) {
    // Idempotent redelivery: BullMQ may hand the same job over twice.
    return { researchId, status: 'SKIPPED', reason: 'ALREADY_COMPLETED' };
  }

  // 2. Source routing and feature gates.
  const source = research.source;
  const sourceConfig = resolveSourceConfig(source, research.researchType, env);

  if (!sourceConfig) {
    await leadResearchService.persistOutcome(researchId, {
      status: 'UNAVAILABLE',
      provider: null,
      confidence: null,
      summary: null,
      structuredData: null,
      provenance: null,
      rawData: null,
      errorCode: 'UNSUPPORTED_URL',
      errorMessage: `Research source "${source}" with type "${research.researchType}" is not supported`,
      completedAt: now(),
    });
    return { researchId, status: 'UNAVAILABLE', reason: 'UNSUPPORTED_URL' };
  }

  if (!sourceConfig.enabled) {
    await leadResearchService.persistOutcome(researchId, {
      status: 'UNAVAILABLE',
      provider: null,
      confidence: null,
      summary: null,
      structuredData: null,
      provenance: null,
      rawData: null,
      errorCode: 'FEATURE_DISABLED',
      errorMessage: `${sourceConfig.label} research is disabled`,
      completedAt: now(),
    });
    await logResearchActivity({
      workspaceId,
      leadId,
      researchId,
      source,
      operation: 'RESEARCH_SKIPPED',
      status: 'UNAVAILABLE',
      errorCode: 'FEATURE_DISABLED',
    });
    logResearch('research_skipped', { researchId, leadId, workspaceId, status: 'UNAVAILABLE', errorCode: 'FEATURE_DISABLED' });
    return { researchId, status: 'UNAVAILABLE', reason: 'FEATURE_DISABLED' };
  }

  // 3. Mark running.
  const startedAt = now();
  await leadResearchService.markInProgress(researchId);
  await logResearchActivity({
    workspaceId,
    leadId,
    researchId,
    source,
    operation: 'RESEARCH_STARTED',
    status: 'IN_PROGRESS',
    startedAt,
  });
  logResearch('research_started', {
    researchId,
    leadId,
    workspaceId,
    source,
    operation: research.researchType,
    startedAt,
    attempt: meta.attemptsMade + 1,
  });

  try {
    // 4. Resolve the provider chain and run it — source-specific routing.
    const run = await sourceConfig.execute(research, env, workspaceId, deps);
    const completedAt = now();
    const update = sourceConfig.mapOutcome(run, completedAt);
    const durationMs = completedAt.getTime() - startedAt.getTime();

    // 5. Retryable failure: persist, then rethrow only while attempts remain.
    if (
      run.outcome.status === 'FAILED' &&
      run.outcome.retryable &&
      RETRYABLE_ERROR_CODES.has(run.outcome.errorCode)
    ) {
      await leadResearchService.persistFailure(
        researchId,
        run.outcome.errorCode,
        run.outcome.errorMessage,
        run.providerUsed,
      );
      await leadResearchService.incrementProviderCounters(workspaceId, source, run.providerUsed, 'failed');
      await logResearchActivity({
        workspaceId,
        leadId,
        researchId,
        source,
        provider: run.providerUsed,
        operation: 'RESEARCH_FAILED',
        status: 'FAILED',
        errorCode: run.outcome.errorCode,
        errorMessage: sanitizeLogMessage(run.outcome.errorMessage),
        startedAt,
        completedAt,
        metadata: { attempts: run.attempts, retryable: true },
      });
      logResearch('research_failed', {
        researchId,
        leadId,
        workspaceId,
        source: source,
        provider: run.providerUsed,
        status: 'FAILED',
        errorCode: run.outcome.errorCode,
        errorMessage: run.outcome.errorMessage,
        durationMs,
        attempt: meta.attemptsMade + 1,
      });
      if (meta.attemptsMade + 1 < meta.maxAttempts) {
        throw new RetryableResearchError(run.outcome.errorCode, run.outcome.errorMessage);
      }
      return { researchId, status: 'FAILED', reason: run.outcome.errorCode };
    }

    // 6. Persist the terminal outcome.
    await leadResearchService.persistOutcome(researchId, {
      ...update,
      inputHash: leadResearchService.computeInputHash(research, sourceConfig.chainProviderNames),
    });

    const counterKind =
      update.status === 'COMPLETED' || update.status === 'PARTIAL'
        ? 'success'
        : update.status === 'MANUAL_REVIEW'
          ? 'manual_review'
          : 'failed';
    await leadResearchService.incrementProviderCounters(workspaceId, source, run.providerUsed, counterKind);

    const operation =
      update.status === 'MANUAL_REVIEW'
        ? 'RESEARCH_MANUAL_REVIEW'
        : update.status === 'COMPLETED' || update.status === 'PARTIAL'
          ? 'RESEARCH_COMPLETED'
          : 'RESEARCH_FAILED';
    await logResearchActivity({
      workspaceId,
      leadId,
      researchId,
      source: source,
      provider: run.providerUsed,
      operation,
      status: update.status,
      errorCode: update.errorCode,
      errorMessage: update.errorMessage ? sanitizeLogMessage(update.errorMessage) : null,
      startedAt,
      completedAt,
      metadata: { attempts: run.attempts },
    });
    logResearch('research_completed', {
      researchId,
      leadId,
      workspaceId,
      source: source,
      provider: run.providerUsed,
      operation: research.researchType,
      status: update.status,
      errorCode: update.errorCode,
      errorMessage: update.errorMessage,
      startedAt,
      completedAt,
      durationMs,
    });

    // 7. Downstream — only when there is data worth qualifying.
    if (update.status === 'COMPLETED' || update.status === 'PARTIAL') {
      void publishWorkflowEvent({
        eventType: 'LEAD_RESEARCH_COMPLETED',
        workspaceId,
        leadId,
        idempotencyKey: `lead-research:${researchId}`,
        metadata: {
          researchId,
          source: source,
          researchType: research.researchType,
          provider: run.providerUsed,
          status: update.status,
          confidence: update.confidence,
        },
      }).catch(() => {});

      await ensureEnrichmentQueued(workspaceId, leadId);
    }

    return { researchId, status: update.status, reason: update.errorCode ?? undefined };
  } catch (error) {
    if (error instanceof RetryableResearchError) throw error;

    const code: ResearchErrorCode = 'UNKNOWN';
    const message = sanitizeLogMessage(error);
    await leadResearchService.persistFailure(researchId, code, message, null);
    await logResearchActivity({
      workspaceId,
      leadId,
      researchId,
      source: source,
      operation: 'RESEARCH_FAILED',
      status: 'FAILED',
      errorCode: code,
      errorMessage: message,
      startedAt,
      completedAt: now(),
    });
    logResearch('research_failed', {
      researchId,
      leadId,
      workspaceId,
      source: source,
      status: 'FAILED',
      errorCode: code,
      errorMessage: message,
      attempt: meta.attemptsMade + 1,
    });
    // Unexpected errors are not retried: the row is FAILED with the reason and
    // a researcher can hit Retry. Non-retryable codes never rethrow.
    return { researchId, status: 'FAILED', reason: code };
  }
}
