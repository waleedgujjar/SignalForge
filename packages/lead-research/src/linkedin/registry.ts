/// Registry of LinkedIn research providers and the chain selector.
///
/// The registry is the single place that decides which providers exist,
/// whether each is configured, and in which order they run. The chain is
/// always `[selected provider(s) if configured and workspace-enabled, manual]`:
/// manual is the terminal provider so a job can never end silently, and it
/// appears exactly once, always last (tested invariants).
///
/// Providers without an authorized integration (LinkedIn's partner API) are
/// deliberately declared but NOT implemented, mirroring the discovery source
/// registry. They surface in settings as "Not implemented".

import type { Env } from '@signalforge/config';

import { sanitizeSecrets } from '../sanitize.js';
import type { LinkedInResearchProvider } from './provider.js';
import { agentReachProvider } from './providers/agent-reach.js';
import { AUTHORIZED_API_DESCRIPTOR } from './providers/authorized-api.js';
import { manualProvider } from './providers/manual.js';
import { publicProvider } from './providers/public.js';
import type { LinkedInProviderName, ProviderDescriptor, ProviderHealth } from './types.js';

const PROVIDERS = new Map<LinkedInProviderName, LinkedInResearchProvider>([
  ['manual', manualProvider],
  ['public', publicProvider],
  ['agent-reach', agentReachProvider],
]);

const PLANNED: ProviderDescriptor[] = [AUTHORIZED_API_DESCRIPTOR];

/// Workspace enablement when no ResearchProviderConfig row exists yet. Public
/// fetch is on by default (user decision) so the module works without a
/// settings visit; Agent-Reach needs an explicit opt-in because it depends on
/// a host-level install.
export const DEFAULT_PROVIDER_WORKSPACE_ENABLED: Record<LinkedInProviderName, boolean> = {
  manual: true,
  public: true,
  'agent-reach': false,
  'authorized-api': false,
};

export function hasProvider(name: string): name is LinkedInProviderName {
  return PROVIDERS.has(name as LinkedInProviderName);
}

export function getProvider(name: LinkedInProviderName): LinkedInResearchProvider {
  const provider = PROVIDERS.get(name);
  if (!provider) throw new Error(`LinkedIn research provider "${name}" is not available in this release`);
  return provider;
}

/// Everything the settings screen needs to render the provider list.
export function listProviders(): ProviderDescriptor[] {
  const implemented: ProviderDescriptor[] = [...PROVIDERS.values()].map((provider) => ({
    provider: provider.name,
    displayName: provider.displayName,
    implemented: true,
    configured: provider.isConfigured(),
  }));
  const planned = PLANNED.filter((entry) => !PROVIDERS.has(entry.provider));
  return [...implemented, ...planned];
}

export type ChainEnv = Pick<Env, 'LINKEDIN_RESEARCH_ENABLED' | 'LINKEDIN_RESEARCH_PROVIDER'>;

export interface SelectProviderChainOptions {
  /// Per-workspace toggle; defaults to DEFAULT_PROVIDER_WORKSPACE_ENABLED.
  workspaceEnabled?: (name: LinkedInProviderName) => boolean;
}

export function selectProviderChain(env: ChainEnv, options: SelectProviderChainOptions = {}): LinkedInResearchProvider[] {
  const workspaceEnabled = options.workspaceEnabled ?? ((name) => DEFAULT_PROVIDER_WORKSPACE_ENABLED[name]);
  if (!env.LINKEDIN_RESEARCH_ENABLED) return [manualProvider];

  const usable = (name: LinkedInProviderName): LinkedInResearchProvider | null => {
    const provider = PROVIDERS.get(name);
    if (!provider || !provider.isConfigured() || !workspaceEnabled(name)) return null;
    return provider;
  };

  const chain: LinkedInResearchProvider[] = [];
  switch (env.LINKEDIN_RESEARCH_PROVIDER) {
    case 'agent-reach': {
      const agentReach = usable('agent-reach');
      const publicPages = usable('public');
      if (agentReach) chain.push(agentReach);
      if (publicPages) chain.push(publicPages);
      break;
    }
    case 'public': {
      const publicPages = usable('public');
      if (publicPages) chain.push(publicPages);
      break;
    }
    case 'manual':
    default:
      break;
  }
  chain.push(manualProvider);
  return chain;
}

// ─── Health checks ────────────────────────────────────────────────────────────

let inFlightHealthCheck: Promise<ProviderHealth[]> | null = null;

async function runChecks(names: LinkedInProviderName[]): Promise<ProviderHealth[]> {
  return Promise.all(
    names.map(async (name) => {
      const provider = getProvider(name);
      try {
        return await provider.healthCheck();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          provider: name,
          displayName: provider.displayName,
          status: 'UNAVAILABLE' as const,
          authentication: 'NOT_CONFIGURED' as const,
          checkedAt: new Date().toISOString(),
          details: [`Health check threw: ${sanitizeSecrets(message).slice(0, 200)}`],
        };
      }
    }),
  );
}

/// Run `healthCheck()` on implemented providers. A single in-flight guard
/// means concurrent callers (two admins clicking at once) share one Agent-Reach
/// process spawn instead of each starting their own.
export async function runProviderHealthChecks(names?: LinkedInProviderName[]): Promise<ProviderHealth[]> {
  const requested = (names ?? [...PROVIDERS.keys()]).filter((name) => PROVIDERS.has(name));
  if (requested.length === 0) return [];

  if (inFlightHealthCheck) {
    const shared = await inFlightHealthCheck;
    const covered = new Set(shared.map((health) => health.provider));
    const missing = requested.filter((name) => !covered.has(name));
    const extra = missing.length > 0 ? await runChecks(missing) : [];
    return [...shared.filter((health) => requested.includes(health.provider)), ...extra];
  }

  const run = runChecks(requested);
  inFlightHealthCheck = run;
  try {
    return await run;
  } finally {
    inFlightHealthCheck = null;
  }
}
