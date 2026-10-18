import { Badge } from '@/components/ui/badge';
import type { WarmupStatus } from '@/lib/api';

const LABELS: Record<WarmupStatus, string> = {
  NOT_STARTED: 'Not started',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  BLOCKED: 'Blocked',
  DISABLED: 'Disabled',
};

const VARIANTS: Record<WarmupStatus, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  NOT_STARTED: 'outline',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'success',
  BLOCKED: 'destructive',
  DISABLED: 'secondary',
};

export function WarmupStatusBadge({ status }: { status: WarmupStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
