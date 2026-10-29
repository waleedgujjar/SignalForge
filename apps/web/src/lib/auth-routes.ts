const PUBLIC_PATHS = ['/', '/login', '/signup'] as const;

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/mailboxes',
  '/campaigns',
  '/leads',
  '/large-leads',
  '/settings',
  '/analytics',
  '/automations',
  '/inbox',
  '/deliverability',
  '/smtp-pools',
  '/smtp-rotation',
  '/warmup',
  '/sending',
  '/website-intelligence',
  '/website-intelligence/studio',
] as const;

export function isAuthPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/signup';
}

export function isOnboardingPath(pathname: string): boolean {
  return pathname.startsWith('/onboarding');
}

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname as (typeof PUBLIC_PATHS)[number]);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
