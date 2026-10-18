import type { ProviderType } from './types.js';

const FREE_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'mail.com',
]);

export function detectProviderType(domain: string): ProviderType {
  const normalized = domain.toLowerCase();
  if (FREE_PROVIDERS.has(normalized)) return 'FREE';
  if (normalized.includes('.') && !FREE_PROVIDERS.has(normalized)) return 'BUSINESS';
  return 'UNKNOWN';
}
