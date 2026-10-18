export type SuppressionType = 'EMAIL' | 'DOMAIN';
export type SuppressionReason =
  | 'MANUAL'
  | 'UNSUBSCRIBED'
  | 'BOUNCED'
  | 'SPAM_COMPLAINT'
  | 'INVALID'
  | 'RISKY';

export interface SuppressionEntry {
  type: SuppressionType;
  value: string;
  reason: SuppressionReason;
}

export interface SuppressionCheckResult {
  suppressed: boolean;
  reason?: SuppressionReason;
  matchedValue?: string;
  matchedType?: SuppressionType;
}

export function checkSuppression(
  email: string,
  suppressions: SuppressionEntry[],
): SuppressionCheckResult {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.split('@')[1] ?? '';

  for (const entry of suppressions) {
    const value = entry.value.trim().toLowerCase();
    if (entry.type === 'EMAIL' && normalized === value) {
      return {
        suppressed: true,
        reason: entry.reason,
        matchedValue: value,
        matchedType: 'EMAIL',
      };
    }
    if (entry.type === 'DOMAIN' && domain === value) {
      return {
        suppressed: true,
        reason: entry.reason,
        matchedValue: value,
        matchedType: 'DOMAIN',
      };
    }
  }

  return { suppressed: false };
}

export function extractDomain(email: string): string {
  return email.trim().toLowerCase().split('@')[1] ?? '';
}
