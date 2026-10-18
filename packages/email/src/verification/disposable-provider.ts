const BUILTIN_DISPOSABLE = [
  'mailinator.com',
  'guerrillamail.com',
  'tempmail.com',
  'throwaway.email',
  'yopmail.com',
  '10minutemail.com',
  'trashmail.com',
  'temp-mail.org',
  'getnada.com',
  'sharklasers.com',
  'maildrop.cc',
  'dispostable.com',
  'fakeinbox.com',
  'mailnesia.com',
];

let cachedSet: Set<string> | null = null;

export interface DisposableDomainProvider {
  isDisposable(domain: string): boolean;
}

export class FileBackedDisposableProvider implements DisposableDomainProvider {
  private domains: Set<string>;

  constructor(extraDomains: string[] = []) {
    this.domains = new Set([...BUILTIN_DISPOSABLE, ...extraDomains].map((d) => d.toLowerCase()));
  }

  isDisposable(domain: string): boolean {
    const normalized = domain.toLowerCase();
    if (this.domains.has(normalized)) return true;
    // subdomain of disposable root
    for (const root of this.domains) {
      if (normalized.endsWith(`.${root}`)) return true;
    }
    return false;
  }
}

export function getDefaultDisposableProvider(): DisposableDomainProvider {
  if (!cachedSet) {
    cachedSet = new Set(BUILTIN_DISPOSABLE);
  }
  return {
    isDisposable(domain: string) {
      const normalized = domain.toLowerCase();
      if (cachedSet!.has(normalized)) return true;
      for (const root of cachedSet!) {
        if (normalized.endsWith(`.${root}`)) return true;
      }
      return false;
    },
  };
}
