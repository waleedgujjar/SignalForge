import { describe, expect, it } from 'vitest';

import { WebResearchService, mapWebOutcomeToRecordUpdate } from '../service.js';
import type { WebResearchProvider } from '../provider.js';
import type { WebProviderName } from '../types.js';
import type { ResearchFailureOutcome, ResearchOutcome } from '../../types.js';

function makeProvider(
  name: string,
  result: ResearchOutcome | (() => Promise<ResearchOutcome>),
): WebResearchProvider {
  return {
    name: name as 'website' | 'manual',
    displayName: name,
    isConfigured: () => true,
    healthCheck: async () => ({
      provider: name as WebProviderName,
      displayName: name,
      status: 'READY' as const,
      authentication: 'NOT_REQUIRED' as const,
      checkedAt: new Date().toISOString(),
      details: [],
    }),
    researchCompany: typeof result === 'function' ? result : async () => result,
  };
}

const input = {
  id: 'r1',
  workspaceId: 'ws1',
  leadId: 'l1',
  normalizedUrl: 'https://acme.com',
  sourceUrl: 'https://acme.com',
};
const hints = { company: 'Acme', domain: 'acme.com' };

describe('WebResearchService', () => {
  it('walks the chain: first provider succeeds → stops (test #5)', async () => {
    const svc = new WebResearchService();
    const website = makeProvider('website', {
      status: 'COMPLETED',
      provider: 'website',
      data: { company: { name: 'Acme' } },
      provenance: [],
      confidence: 'MEDIUM',
      summary: 'Acme',
    });
    const manual = makeProvider('manual', {
      status: 'MANUAL_REVIEW',
      provider: 'manual',
      errorCode: 'MANUAL_REQUIRED',
      errorMessage: 'Manual review needed',
      retryable: false,
    });

    const result = await svc.run(input, hints, [website, manual], 30_000);

    expect(result.providerUsed).toBe('website');
    expect(result.outcome.status).toBe('COMPLETED');
    expect(result.attempts).toHaveLength(1);
  });

  it('walks the chain: first UNAVAILABLE → falls to manual (test #13)', async () => {
    const svc = new WebResearchService();
    const website = makeProvider('website', {
      status: 'UNAVAILABLE',
      provider: 'website',
      errorCode: 'PROVIDER_NOT_CONFIGURED',
      errorMessage: 'Not configured',
      retryable: false,
    });
    const manual = makeProvider('manual', {
      status: 'MANUAL_REVIEW',
      provider: 'manual',
      errorCode: 'MANUAL_REQUIRED',
      errorMessage: 'Manual review needed',
      retryable: false,
    });

    const result = await svc.run(input, hints, [website, manual], 30_000);

    expect(result.providerUsed).toBe('manual');
    expect(result.outcome.status).toBe('MANUAL_REVIEW');
    expect(result.attempts).toHaveLength(2);
  });

  it('handles provider timeout via AbortController (test #8)', async () => {
    const svc = new WebResearchService();
    const slow: WebResearchProvider = {
      name: 'website',
      displayName: 'website',
      isConfigured: () => true,
      healthCheck: async () => ({ provider: 'website', displayName: 'website', status: 'READY' as const, authentication: 'NOT_REQUIRED' as const, checkedAt: new Date().toISOString(), details: [] }),
      async researchCompany(_input, ctx) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 10_000);
          ctx.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        });
        return { status: 'COMPLETED', provider: 'website', data: {}, provenance: [], confidence: 'LOW' as const, summary: '' };
      },
    };

    const result = await svc.run(input, hints, [slow], 50);

    expect(result.outcome.status).toBe('FAILED');
    if (result.outcome.status === 'COMPLETED' || result.outcome.status === 'PARTIAL') throw new Error('unexpected');
    const failedOutcome1 = result.outcome as ResearchFailureOutcome;
    expect(failedOutcome1.errorCode).toBe('TIMEOUT');
    expect(failedOutcome1.retryable).toBe(true);
  });

  it('handles provider throw as PROVIDER_UNAVAILABLE', async () => {
    const svc = new WebResearchService();
    const broken = makeProvider('website', async () => {
      throw new Error('Connection reset');
    });

    const result = await svc.run(input, hints, [broken], 30_000);

    expect(result.outcome.status).toBe('FAILED');
    if (result.outcome.status === 'COMPLETED' || result.outcome.status === 'PARTIAL') throw new Error('unexpected');
    const failedOutcome2 = result.outcome as ResearchFailureOutcome;
    expect(failedOutcome2.errorCode).toBe('PROVIDER_UNAVAILABLE');
    expect(failedOutcome2.retryable).toBe(true);
  });
});

describe('mapWebOutcomeToRecordUpdate', () => {
  it('maps a COMPLETED outcome to a record update', () => {
    const run = {
      outcome: {
        status: 'COMPLETED' as const,
        provider: 'website',
        data: { company: { name: 'Acme' } },
        provenance: [],
        confidence: 'MEDIUM' as const,
        summary: 'Acme',
      },
      attempts: [],
      providerUsed: 'website',
    };
    const update = mapWebOutcomeToRecordUpdate(run, new Date());
    expect(update.status).toBe('COMPLETED');
    expect(update.provider).toBe('website');
    expect(update.structuredData).toEqual({ company: { name: 'Acme' } });
    expect(update.errorCode).toBeNull();
  });

  it('maps a FAILED outcome to a record update', () => {
    const run = {
      outcome: {
        status: 'FAILED' as const,
        provider: 'website',
        errorCode: 'PAGE_UNAVAILABLE' as const,
        errorMessage: 'No pages retrieved',
        retryable: false,
      },
      attempts: [],
      providerUsed: 'website',
    };
    const update = mapWebOutcomeToRecordUpdate(run, new Date());
    expect(update.status).toBe('FAILED');
    expect(update.errorCode).toBe('PAGE_UNAVAILABLE');
    expect(update.structuredData).toBeNull();
  });
});
