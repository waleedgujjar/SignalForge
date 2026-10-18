/// Web chain execution service.
///
/// `WebResearchService.run()` walks the provider chain for one research record.
/// Each provider gets a single opportunity with an AbortController-backed
/// timeout. Web research is COMPANY-only.

import type {
  ResearchOutcome,
  ResearchContext,
  ProviderAttempt,
  ResearchRecordUpdate,
  ResearchErrorCode,
  ResearchSuccessOutcome,
  ResearchFailureOutcome,
} from '../types.js';
import { isSuccessOutcome } from '../types.js';
import type { WebResearchProvider, WebCompanyResearchInput } from './provider.js';

export interface WebResearchRunInput {
  id: string;
  workspaceId: string;
  leadId: string;
  normalizedUrl: string | null;
  sourceUrl: string | null;
}

export interface WebLeadHints {
  company: string | null;
  domain: string | null;
}

export interface WebChainRunResult {
  outcome: ResearchOutcome;
  attempts: ProviderAttempt[];
  providerUsed: string;
}

export class WebResearchService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async run(
    input: WebResearchRunInput,
    hints: WebLeadHints,
    chain: WebResearchProvider[],
    timeoutMs: number,
  ): Promise<WebChainRunResult> {
    const attempts: ProviderAttempt[] = [];
    const chainNotes: string[] = [];

    for (const provider of chain) {
      const startedAt = this.now();
      const ctx: ResearchContext = {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        researchId: input.id,
        timeoutMs,
        chainNotes,
      };

      let outcome: ResearchOutcome;
      try {
        outcome = await this.callProvider(provider, input, hints, ctx, timeoutMs);
      } catch (error) {
        const completedAt = this.now();
        const durationMs = completedAt.getTime() - startedAt.getTime();
        const errorMessage = error instanceof Error ? error.message : String(error);
        attempts.push({
          provider: provider.name,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs,
          status: 'FAILED',
          errorCode: 'PROVIDER_UNAVAILABLE',
          errorMessage,
        });
        return {
          outcome: { status: 'FAILED', provider: provider.name, errorCode: 'PROVIDER_UNAVAILABLE', errorMessage, retryable: true },
          attempts,
          providerUsed: provider.name,
        };
      }

      const completedAt = this.now();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      attempts.push({
        provider: provider.name,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
        status: outcome.status,
        errorCode: isSuccessOutcome(outcome) ? null : (outcome as ResearchFailureOutcome).errorCode,
        errorMessage: isSuccessOutcome(outcome) ? null : (outcome as ResearchFailureOutcome).errorMessage,
      });

      if (this.shouldContinueChain(outcome)) {
        const failure = outcome as ResearchFailureOutcome;
        chainNotes.push(`${provider.displayName}: ${failure.errorMessage}`);
        continue;
      }

      return { outcome, attempts, providerUsed: provider.name };
    }

    const lastAttempt = attempts[attempts.length - 1];
    return {
      outcome: {
        status: 'FAILED',
        provider: lastAttempt?.provider ?? 'unknown',
        errorCode: 'PROVIDER_UNAVAILABLE',
        errorMessage: 'No provider in the chain produced a terminal outcome',
        retryable: false,
      },
      attempts,
      providerUsed: lastAttempt?.provider ?? 'unknown',
    };
  }

  private async callProvider(
    provider: WebResearchProvider,
    input: WebResearchRunInput,
    hints: WebLeadHints,
    ctx: ResearchContext,
    timeoutMs: number,
  ): Promise<ResearchOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const ctxWithSignal: ResearchContext = { ...ctx, signal: controller.signal };

    try {
      const companyInput: WebCompanyResearchInput = {
        url: input.normalizedUrl ?? undefined,
        companyName: hints.company ?? undefined,
        domain: hints.domain ?? undefined,
      };
      return await provider.researchCompany(companyInput, ctxWithSignal);
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          status: 'FAILED',
          provider: provider.name,
          errorCode: 'TIMEOUT' as ResearchErrorCode,
          errorMessage: `Provider ${provider.displayName} timed out after ${timeoutMs}ms`,
          retryable: true,
        };
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private shouldContinueChain(outcome: ResearchOutcome): boolean {
    if (isSuccessOutcome(outcome)) return false;
    const failure = outcome as ResearchFailureOutcome;
    if (failure.status !== 'UNAVAILABLE') return false;
    const passableCodes: ReadonlySet<ResearchErrorCode> = new Set(['PROVIDER_NOT_CONFIGURED', 'PROVIDER_UNAVAILABLE']);
    if (!passableCodes.has(failure.errorCode)) return false;
    if (failure.retryable) return false;
    return true;
  }
}

export function mapWebOutcomeToRecordUpdate(
  run: WebChainRunResult,
  completedAt: Date,
): ResearchRecordUpdate & { completedAt: Date } {
  const { outcome, attempts } = run;

  if (isSuccessOutcome(outcome)) {
    const success = outcome as ResearchSuccessOutcome;
    return {
      status: success.status,
      provider: success.provider,
      confidence: success.confidence,
      summary: success.summary,
      structuredData: success.data,
      provenance: success.provenance,
      rawData: success.raw ?? null,
      errorCode: null,
      errorMessage: null,
      attempts,
      retryable: false,
      completedAt,
    };
  }

  const failure = outcome as ResearchFailureOutcome;
  return {
    status: failure.status,
    provider: failure.provider,
    confidence: null,
    summary: null,
    structuredData: null,
    provenance: null,
    rawData: null,
    errorCode: failure.errorCode,
    errorMessage: failure.errorMessage,
    attempts,
    retryable: failure.retryable,
    completedAt,
  };
}
