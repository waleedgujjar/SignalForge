import { Badge } from '@/components/ui/badge';
import type { VerificationTier } from '@/lib/api';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning';

const STATUS_LABEL: Record<string, string> = {
  VERIFIED: 'Valid',
  ROLE_BASED: 'Role',
  RISKY: 'Risky',
  INVALID: 'Invalid',
  UNKNOWN: 'Unknown',
  DISPOSABLE: 'Disposable',
  CATCH_ALL: 'Catch-all',
  UNVERIFIED: 'Unverified',
};

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  VERIFIED: 'success',
  ROLE_BASED: 'secondary',
  RISKY: 'warning',
  INVALID: 'destructive',
  UNKNOWN: 'secondary',
  DISPOSABLE: 'destructive',
  CATCH_ALL: 'warning',
  UNVERIFIED: 'outline',
};

/** Filter options for verification status, in the order users scan them. */
export const VERIFICATION_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'VERIFIED', label: 'Valid' },
  { value: 'CATCH_ALL', label: 'Catch-all' },
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'RISKY', label: 'Risky' },
  { value: 'ROLE_BASED', label: 'Role' },
  { value: 'INVALID', label: 'Invalid' },
  { value: 'DISPOSABLE', label: 'Disposable' },
  { value: 'UNVERIFIED', label: 'Unverified' },
  { value: 'NEEDS_VERIFICATION', label: 'Needs (re-)verification' },
];

export function VerificationStatusBadge({ status }: { status: string | null | undefined }) {
  const key = status ?? 'UNVERIFIED';
  return <Badge variant={STATUS_VARIANT[key] ?? 'outline'}>{STATUS_LABEL[key] ?? key}</Badge>;
}

export function verificationStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/** Mirrors the API's eligibility tiers so the UI can show it before enrollment. */
export function verificationTier(status: string | null | undefined): VerificationTier {
  switch (status) {
    case 'VERIFIED':
      return 'ELIGIBLE';
    case 'INVALID':
    case 'DISPOSABLE':
      return 'NOT_ELIGIBLE';
    case 'RISKY':
    case 'UNKNOWN':
    case 'CATCH_ALL':
    case 'ROLE_BASED':
      return 'REVIEW';
    default:
      return 'UNVERIFIED';
  }
}

const TIER_LABEL: Record<VerificationTier, string> = {
  ELIGIBLE: 'Eligible',
  REVIEW: 'Review required',
  NOT_ELIGIBLE: 'Not eligible',
  UNVERIFIED: 'Verify first',
};

const TIER_VARIANT: Record<VerificationTier, BadgeVariant> = {
  ELIGIBLE: 'success',
  REVIEW: 'warning',
  NOT_ELIGIBLE: 'destructive',
  UNVERIFIED: 'outline',
};

export function EligibilityTierBadge({ tier }: { tier: VerificationTier }) {
  return <Badge variant={TIER_VARIANT[tier]}>{TIER_LABEL[tier]}</Badge>;
}
