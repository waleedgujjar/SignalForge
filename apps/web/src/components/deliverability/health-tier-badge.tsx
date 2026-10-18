import { Badge } from '@/components/ui/badge';
import type { DnsCheckStatus, HealthTier, ProtectionLevel } from '@/lib/api';

const TIER_LABELS: Record<HealthTier, string> = {
  EXCELLENT: 'Excellent',
  HEALTHY: 'Healthy',
  NEEDS_ATTENTION: 'Needs attention',
  AT_RISK: 'At risk',
  CRITICAL: 'Critical',
};

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';

const TIER_VARIANTS: Record<HealthTier, BadgeVariant> = {
  EXCELLENT: 'success',
  HEALTHY: 'success',
  NEEDS_ATTENTION: 'warning',
  AT_RISK: 'warning',
  CRITICAL: 'destructive',
};

export function HealthTierBadge({ tier }: { tier: HealthTier }) {
  return <Badge variant={TIER_VARIANTS[tier]}>{TIER_LABELS[tier]}</Badge>;
}

const PROTECTION_LABELS: Record<ProtectionLevel, string> = {
  NORMAL: 'Normal',
  WARNING: 'Warning',
  AT_RISK: 'At risk',
  CRITICAL: 'Critical',
};

const PROTECTION_VARIANTS: Record<ProtectionLevel, BadgeVariant> = {
  NORMAL: 'success',
  WARNING: 'warning',
  AT_RISK: 'warning',
  CRITICAL: 'destructive',
};

export function ProtectionBadge({ level }: { level: ProtectionLevel }) {
  return <Badge variant={PROTECTION_VARIANTS[level]}>{PROTECTION_LABELS[level]}</Badge>;
}

const DNS_LABELS: Record<DnsCheckStatus, string> = {
  PASS: 'Pass',
  FAIL: 'Not found',
  INVALID: 'Invalid',
  UNKNOWN: 'Unknown',
  NOT_CHECKED: 'Not checked',
};

const DNS_VARIANTS: Record<DnsCheckStatus, BadgeVariant> = {
  PASS: 'success',
  FAIL: 'destructive',
  INVALID: 'warning',
  UNKNOWN: 'secondary',
  NOT_CHECKED: 'outline',
};

export function DnsStatusBadge({ status }: { status: DnsCheckStatus }) {
  return <Badge variant={DNS_VARIANTS[status]}>{DNS_LABELS[status]}</Badge>;
}
