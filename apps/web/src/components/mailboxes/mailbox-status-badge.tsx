import { Badge } from '@/components/ui/badge';
import type { MailboxStatus } from '@/lib/api';

const STATUS_LABEL: Record<MailboxStatus, string> = {
  ACTIVE: 'Active',
  UNVERIFIED: 'Unverified',
  DISABLED: 'Disabled',
  PAUSED: 'Paused',
  ERROR: 'Error',
  DISCONNECTED: 'Disconnected',
};

const STATUS_VARIANT: Record<MailboxStatus, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  ACTIVE: 'success',
  UNVERIFIED: 'warning',
  DISABLED: 'secondary',
  PAUSED: 'warning',
  ERROR: 'destructive',
  DISCONNECTED: 'destructive',
};

export function MailboxStatusBadge({ status }: { status: MailboxStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
