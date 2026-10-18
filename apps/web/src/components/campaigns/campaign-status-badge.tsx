import { Badge } from '@/components/ui/badge';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'secondary' | 'default' | 'outline' | 'destructive'> = {
  ACTIVE: 'success',
  SCHEDULED: 'default',
  PAUSED: 'warning',
  DRAFT: 'secondary',
  STOPPED: 'destructive',
  COMPLETED: 'default',
  ARCHIVED: 'outline',
};

export function CampaignStatusBadge({ status }: { status: string }) {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return <Badge variant={STATUS_VARIANT[status] ?? 'default'}>{label}</Badge>;
}
