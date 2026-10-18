/// The terminal provider. Always configured, always last in the chain, so a
/// research job can never end silently: whatever the earlier providers could
/// not do lands here as MANUAL_REVIEW with the accumulated reasons, and a
/// researcher enters what they personally confirmed on the profile.

import type { ResearchContext, ResearchOutcome } from '../../types.js';
import type { LinkedInResearchProvider } from '../provider.js';
import { failureOutcome } from '../provider.js';
import type { ProviderHealth } from '../types.js';

export const MANUAL_PROVIDER_DISPLAY_NAME = 'Manual verification';

export class ManualLinkedInProvider implements LinkedInResearchProvider {
  readonly name = 'manual' as const;
  readonly displayName = MANUAL_PROVIDER_DISPLAY_NAME;

  constructor(private readonly now: () => Date = () => new Date()) {}

  isConfigured(): boolean {
    return true;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      provider: this.name,
      displayName: this.displayName,
      status: 'READY',
      authentication: 'NOT_REQUIRED',
      checkedAt: this.now().toISOString(),
      details: ['A researcher enters data confirmed on the profile; nothing is fetched automatically.'],
    };
  }

  async researchCompany(_input: unknown, ctx: ResearchContext): Promise<ResearchOutcome> {
    return this.manualReview(ctx);
  }

  async researchPerson(_input: unknown, ctx: ResearchContext): Promise<ResearchOutcome> {
    return this.manualReview(ctx);
  }

  private manualReview(ctx: ResearchContext): ResearchOutcome {
    const notes = ctx.chainNotes.filter((note) => note.trim().length > 0);
    const reason =
      notes.length > 0 ? `Manual verification required: ${notes.join('; ')}` : 'Manual verification required';
    return failureOutcome(this.name, 'MANUAL_REVIEW', 'MANUAL_REQUIRED', reason, false);
  }
}

export const manualProvider = new ManualLinkedInProvider();
