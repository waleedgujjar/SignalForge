import { Badge } from '@/components/ui/badge';
import type { MailboxHealthStatus } from '@/lib/api';

const LABEL: Record<MailboxHealthStatus, string> = {
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  UNHEALTHY: 'Critical',
  UNKNOWN: 'Untested',
};

const VARIANT: Record<MailboxHealthStatus, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  HEALTHY: 'success',
  DEGRADED: 'warning',
  UNHEALTHY: 'destructive',
  UNKNOWN: 'secondary',
};

export function MailboxHealthBadge({ status }: { status: MailboxHealthStatus }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>;
}
