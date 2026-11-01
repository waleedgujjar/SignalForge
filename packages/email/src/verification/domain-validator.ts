import { lookup } from './dns-resolver.js';
import { isBlockedHostname } from './network-guard.js';
import type { DomainCheckResult } from './types.js';

export interface DomainValidationResult {
  result: DomainCheckResult;
  dnsResolved: boolean;
  domainValid: boolean;
}

/**
 * A domain is valid for email when it exists in DNS. It does not need an A
 * record: many mail-only domains publish MX records and nothing else, so
 * NODATA on one record type is not proof the domain is missing.
 */
export async function validateDomain(domain: string): Promise<DomainValidationResult> {
  if (!domain || isBlockedHostname(domain)) {
    return { result: 'DOMAIN_INVALID', dnsResolved: false, domainValid: false };
  }

  const outcomes = await Promise.all([
    lookup((r) => r.resolveMx(domain)),
    lookup((r) => r.resolve4(domain)),
    lookup((r) => r.resolve6(domain)),
  ]);

  if (outcomes.some((o) => o.kind === 'ok')) {
    return { result: 'DOMAIN_VALID', dnsResolved: true, domainValid: true };
  }
  if (outcomes.some((o) => o.kind === 'nxdomain')) {
    return { result: 'DOMAIN_NOT_FOUND', dnsResolved: false, domainValid: false };
  }
  if (outcomes.every((o) => o.kind === 'nodata')) {
    // The name exists (NOERROR) but publishes no address or mail records.
    return { result: 'DOMAIN_NOT_FOUND', dnsResolved: true, domainValid: false };
  }
  if (outcomes.some((o) => o.kind === 'timeout')) {
    return { result: 'DNS_TIMEOUT', dnsResolved: false, domainValid: false };
  }
  return { result: 'DNS_ERROR', dnsResolved: false, domainValid: false };
}
