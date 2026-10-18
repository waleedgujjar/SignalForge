/// LinkedIn chain execution service.
///
/// `LinkedInResearchService.run()` walks the provider chain for one research
/// record. Each provider gets a single fetch opportunity with an
/// AbortController-backed timeout. The chain stops on the first terminal
/// outcome (success, manual review, rate limit, auth wall, timeout, or any
/// non-chain-pass failure) and returns the full run trace for the worker to
/// persist.
///
/// `mapOutcomeToRecordUpdate` converts a `ChainRunResult` into the flat shape
/// the worker writes to `LeadResearch`.

import type { LeadResearchType } from '@signalforge/database';

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
import type { LinkedInResearchProvider, CompanyResearchInput, PersonResearchInput } from './provider.js';

// ─── Service input ───────────────────────────────────────────────────────────

export interface ResearchRunInput {
  id: string;
  workspaceId: string;
  leadId: string;
  researchType: LeadResearchType;
  normalizedUrl: string | null;
  sourceUrl: string | null;
}

export interface LeadHints {
  company: string | null;
  fullName: string | null;
}

// ─── Chain run result ────────────────────────────────────────────────────────

export interface ChainRunResult {
  outcome: ResearchOutcome;
  attempts: ProviderAttempt[];
  providerUsed: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class LinkedInResearchService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async run(
    input: ResearchRunInput,
    hints: LeadHints,
    chain: LinkedInResearchProvider[],
    timeoutMs: number,
  ): Promise<ChainRunResult> {
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
        // Unexpected throw — record it and stop the chain.
        const completedAt = this.now();
        const durationMs = completedAt.getTime() - startedAt.getTime();
        const errorMessage = error instanceof Error ? error.message : String(error);
        const attempt: ProviderAttempt = {
          provider: provider.name,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          durationMs,
          status: 'FAILED',
          errorCode: 'PROVIDER_UNAVAILABLE',
          errorMessage,
        };
        attempts.push(attempt);
        return {
          outcome: {
            status: 'FAILED',
            provider: provider.name,
            errorCode: 'PROVIDER_UNAVAILABLE',
            errorMessage,
            retryable: true,
          },
          attempts,
          providerUsed: provider.name,
        };
      }

      const completedAt = this.now();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      const attempt: ProviderAttempt = {
        provider: provider.name,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
        status: outcome.status,
        errorCode: isSuccessOutcome(outcome) ? null : outcome.errorCode,
        errorMessage: isSuccessOutcome(outcome) ? null : outcome.errorMessage,
      };
      attempts.push(attempt);

      // Chain-pass logic: only UNAVAILABLE with specific non-retryable codes
      // passes to the next provider. Everything else is terminal.
      if (this.shouldContinueChain(outcome)) {
        const failureOutcome = outcome as ResearchFailureOutcome;
        chainNotes.push(
          `${provider.displayName}: ${failureOutcome.errorMessage}`,
        );
        continue;
      }

      return {
        outcome,
        attempts,
        providerUsed: provider.name,
      };
    }

    // Should never be reached because the chain always ends with `manual`,
    // but guard defensively.
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

  // ─── Private ─────────────────────────────────────────────────────────────

  private async callProvider(
    provider: LinkedInResearchProvider,
    input: ResearchRunInput,
    hints: LeadHints,
    ctx: ResearchContext,
    timeoutMs: number,
  ): Promise<ResearchOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const ctxWithSignal: ResearchContext = { ...ctx, signal: controller.signal };

    try {
      if (input.researchType === 'COMPANY') {
        const companyInput: CompanyResearchInput = {
          url: input.normalizedUrl ?? undefined,
          companyName: hints.company ?? undefined,
        };
        return await provider.researchCompany(companyInput, ctxWithSignal);
      } else {
        const personInput: PersonResearchInput = {
          url: input.normalizedUrl ?? undefined,
          name: hints.fullName ?? undefined,
          company: hints.company ?? undefined,
        };
        return await provider.researchPerson(personInput, ctxWithSignal);
      }
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

  /// A provider that returns UNAVAILABLE with PROVIDER_NOT_CONFIGURED or
  /// PROVIDER_UNAVAILABLE (non-retryable) passes the baton to the next
  /// provider. Every other outcome — success, manual review, rate limit,
  /// auth wall, timeout, any other failure — stops the chain.
  private shouldContinueChain(outcome: ResearchOutcome): boolean {
    if (isSuccessOutcome(outcome)) return false;

    const failure = outcome as ResearchFailureOutcome;
    if (failure.status !== 'UNAVAILABLE') return false;

    const passableCodes: ReadonlySet<ResearchErrorCode> = new Set([
      'PROVIDER_NOT_CONFIGURED',
      'PROVIDER_UNAVAILABLE',
    ]);
    if (!passableCodes.has(failure.errorCode)) return false;

    // A retryable PROVIDER_UNAVAILABLE means a transient infra issue — the
    // worker should retry the whole job, not silently skip to the next provider.
    if (failure.retryable) return false;

    return true;
  }
}

// ─── Outcome → record update ─────────────────────────────────────────────────

export function mapOutcomeToRecordUpdate(
  run: ChainRunResult,
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
