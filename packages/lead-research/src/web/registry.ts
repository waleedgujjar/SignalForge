/// Registry of web research providers and the chain selector.

import type { Env } from '@signalforge/config';

import type { WebResearchProvider, WebProviderHealth } from './provider.js';
import { websiteProvider } from './providers/website.js';
import { webManualProvider } from './providers/manual.js';
import type { WebProviderName } from './types.js';

const PROVIDERS = new Map<WebProviderName, WebResearchProvider>([
  ['website', websiteProvider],
  ['manual', webManualProvider],
]);

export const DEFAULT_WEB_PROVIDER_WORKSPACE_ENABLED: Record<WebProviderName, boolean> = {
  website: true,
  manual: true,
};

export type WebChainEnv = Pick<Env, 'WEB_RESEARCH_ENABLED'>;

export function selectWebProviderChain(env: WebChainEnv): WebResearchProvider[] {
  if (!env.WEB_RESEARCH_ENABLED) return [webManualProvider];

  const chain: WebResearchProvider[] = [];
  const website = PROVIDERS.get('website');
  if (website?.isConfigured()) chain.push(website);
  chain.push(webManualProvider);
  return chain;
}

export function listWebProviders(): Array<{ provider: WebProviderName; displayName: string; implemented: boolean; configured: boolean }> {
  return [...PROVIDERS.values()].map((p) => ({
    provider: p.name,
    displayName: p.displayName,
    implemented: true,
    configured: p.isConfigured(),
  }));
}

export async function runWebProviderHealthChecks(): Promise<WebProviderHealth[]> {
  const results: WebProviderHealth[] = [];
  for (const provider of PROVIDERS.values()) {
    try {
      results.push(await provider.healthCheck());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        provider: provider.name,
        displayName: provider.displayName,
        status: 'UNAVAILABLE',
        authentication: 'NOT_CONFIGURED',
        checkedAt: new Date().toISOString(),
        details: [`Health check threw: ${message.slice(0, 200)}`],
      });
    }
  }
  return results;
}
