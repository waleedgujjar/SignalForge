import { isBlockedHostname } from './network-guard.js';
import type { DomainCheckResult } from './types.js';

const DNS_TIMEOUT_MS = 5000;

export interface DomainValidationResult {
  result: DomainCheckResult;
  dnsResolved: boolean;
  domainValid: boolean;
}

export async function validateDomain(domain: string): Promise<DomainValidationResult> {
  if (!domain || isBlockedHostname(domain)) {
    return { result: 'DOMAIN_INVALID', dnsResolved: false, domainValid: false };
  }

  const { promises: dns } = await import('node:dns');
  try {
    await withTimeout(dns.resolve(domain), DNS_TIMEOUT_MS);
    return { result: 'DOMAIN_VALID', dnsResolved: true, domainValid: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      return { result: 'DOMAIN_NOT_FOUND', dnsResolved: false, domainValid: false };
    }
    if (code === 'ETIMEOUT') {
      return { result: 'DNS_TIMEOUT', dnsResolved: false, domainValid: false };
    }
    return { result: 'DNS_ERROR', dnsResolved: false, domainValid: false };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => {
        const err = new Error('DNS timeout') as NodeJS.ErrnoException;
        err.code = 'ETIMEOUT';
        reject(err);
      }, ms),
    ),
  ]);
}
