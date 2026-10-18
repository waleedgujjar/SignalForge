/// Terminal web research provider — always last in the chain.
///
/// Returns MANUAL_REVIEW with accumulated chain notes so a researcher can
/// enter findings by hand. Always configured, never skipped.

import type { ResearchContext, ResearchOutcome } from '../../types.js';
import type { WebResearchProvider, WebCompanyResearchInput, WebProviderHealth } from '../provider.js';

export const webManualProvider: WebResearchProvider = {
  name: 'manual',
  displayName: 'Manual Entry',

  isConfigured(): boolean {
    return true;
  },

  async healthCheck(): Promise<WebProviderHealth> {
    return {
      provider: 'manual',
      displayName: 'Manual Entry',
      status: 'READY',
      authentication: 'NOT_REQUIRED',
      checkedAt: new Date().toISOString(),
      details: ['Manual entry is always available'],
    };
  },

  async researchCompany(_input: WebCompanyResearchInput, ctx: ResearchContext): Promise<ResearchOutcome> {
    const notes = ctx.chainNotes.length > 0
      ? `Automated providers could not complete research: ${ctx.chainNotes.join('; ')}`
      : 'No automated providers were available';

    return {
      status: 'MANUAL_REVIEW',
      provider: 'manual',
      errorCode: 'MANUAL_REQUIRED',
      errorMessage: notes,
      retryable: false,
    };
  },
};
