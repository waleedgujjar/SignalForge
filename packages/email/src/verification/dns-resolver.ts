import { Resolver } from 'node:dns/promises';

const DNS_TIMEOUT_MS = 5000;

// Public resolvers used when the system resolver errors. A single SERVFAIL or
// timeout from a container's resolver must never decide a verification result.
const FALLBACK_SERVERS = ['1.1.1.1', '8.8.8.8'];

export type DnsOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'nxdomain' }
  | { kind: 'nodata' }
  | { kind: 'timeout' }
  | { kind: 'error'; code: string };

let systemResolver: Resolver | null = null;
let fallbackResolver: Resolver | null = null;

function resolvers(): Resolver[] {
  if (!systemResolver) {
    systemResolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
  }
  if (!fallbackResolver) {
    fallbackResolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
    fallbackResolver.setServers(FALLBACK_SERVERS);
  }
  return [systemResolver, fallbackResolver];
}

function classify<T>(err: unknown): DnsOutcome<T> {
  const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
  if (code === 'ENOTFOUND') return { kind: 'nxdomain' };
  if (code === 'ENODATA') return { kind: 'nodata' };
  if (code === 'ETIMEOUT' || code === 'ETIMEDOUT') return { kind: 'timeout' };
  return { kind: 'error', code };
}

/**
 * Runs a lookup against the system resolver, then the public fallback.
 * Authoritative answers (records, NXDOMAIN, NODATA) are returned immediately;
 * only transient failures (SERVFAIL, timeout, refused) move on to the fallback.
 */
export async function lookup<T>(query: (resolver: Resolver) => Promise<T>): Promise<DnsOutcome<T>> {
  let last: DnsOutcome<T> = { kind: 'error', code: 'UNKNOWN' };
  for (const resolver of resolvers()) {
    try {
      return { kind: 'ok', value: await query(resolver) };
    } catch (err) {
      last = classify<T>(err);
      if (last.kind === 'nxdomain' || last.kind === 'nodata') return last;
    }
  }
  return last;
}

export function resetDnsResolversForTests(): void {
  systemResolver = null;
  fallbackResolver = null;
}
