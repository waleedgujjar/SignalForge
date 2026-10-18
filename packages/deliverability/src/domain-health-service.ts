import { prisma } from '@signalforge/database';
import { checkDomainAuth, normalizeDomain, type DnsLookupOptions } from './dns-checker.js';
import { deliverabilityPolicyService } from './policy-service.js';

export class DomainHealthCheckRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Domain check is rate limited. Try again in ${retryAfterSeconds}s.`);
    this.name = 'DomainHealthCheckRateLimitError';
  }
}

export interface RunDomainCheckOptions {
  /// Bypass the cache. Still subject to the per-domain cooldown.
  force?: boolean;
  lookupOptions?: DnsLookupOptions;
}

/**
 * Caches DNS authentication results per workspace+domain. Reads are served from
 * the cache until `expiresAt`, and manual re-checks are cooldown-limited so a
 * frontend cannot drive unbounded DNS traffic.
 */
export class DomainHealthService {
  async list(workspaceId: string) {
    return prisma.domainHealthCheck.findMany({
      where: { workspaceId },
      orderBy: { domain: 'asc' },
    });
  }

  async get(workspaceId: string, domain: string) {
    return prisma.domainHealthCheck.findUnique({
      where: { workspaceId_domain: { workspaceId, domain: normalizeDomain(domain) } },
    });
  }

  /// Domains derived from the workspace's mailbox addresses, which is what the
  /// domains view offers to check.
  async listSendingDomains(workspaceId: string): Promise<string[]> {
    const mailboxes = await prisma.mailbox.findMany({
      where: { workspaceId },
      select: { emailAddress: true },
    });
    const domains = new Set<string>();
    for (const mailbox of mailboxes) {
      const domain = normalizeDomain(mailbox.emailAddress);
      if (domain) domains.add(domain);
    }
    return [...domains].sort();
  }

  async runCheck(workspaceId: string, domain: string, options: RunDomainCheckOptions = {}) {
    const normalized = normalizeDomain(domain);
    if (!normalized) throw new Error('Invalid domain.');

    const { thresholds } = await deliverabilityPolicyService.get(workspaceId);
    const existing = await this.get(workspaceId, normalized);
    const now = new Date();

    if (existing && !options.force && existing.expiresAt > now) {
      return existing;
    }

    if (existing) {
      const cooldownMs = thresholds.dnsRecheckCooldownMinutes * 60_000;
      const elapsed = now.getTime() - existing.checkedAt.getTime();
      if (elapsed < cooldownMs) {
        throw new DomainHealthCheckRateLimitError(Math.ceil((cooldownMs - elapsed) / 1000));
      }
    }

    const selectors = options.lookupOptions?.dkimSelectors ?? extractSelectors(existing?.dkimSelectors);
    const result = await checkDomainAuth(normalized, {
      ...options.lookupOptions,
      dkimSelectors: selectors,
    });

    const expiresAt = new Date(now.getTime() + thresholds.dnsCacheTtlHours * 3600_000);
    const data = {
      spfStatus: result.spfStatus,
      dkimStatus: result.dkimStatus,
      dmarcStatus: result.dmarcStatus,
      mxStatus: result.mxStatus,
      spfRecord: result.spfRecord,
      dmarcPolicy: result.dmarcPolicy,
      dkimSelectors: result.dkimSelectors,
      rawResults: { checkedAt: result.checkedAt.toISOString() },
      lastError: result.lastError,
      checkedAt: result.checkedAt,
      expiresAt,
    };

    return prisma.domainHealthCheck.upsert({
      where: { workspaceId_domain: { workspaceId, domain: normalized } },
      create: { workspaceId, domain: normalized, ...data },
      update: data,
    });
  }

  /// Registers a DKIM selector so subsequent checks can resolve DKIM instead of
  /// reporting UNKNOWN.
  async addSelector(workspaceId: string, domain: string, selector: string) {
    const normalized = normalizeDomain(domain);
    const existing = await this.get(workspaceId, normalized);
    const selectors = new Set(extractSelectors(existing?.dkimSelectors));
    selectors.add(selector.trim());
    return this.runCheck(workspaceId, normalized, {
      force: true,
      lookupOptions: { dkimSelectors: [...selectors] },
    });
  }
}

function extractSelectors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && 'selector' in entry) {
        const selector = (entry as { selector?: unknown }).selector;
        return typeof selector === 'string' ? selector : null;
      }
      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

export const domainHealthService = new DomainHealthService();
