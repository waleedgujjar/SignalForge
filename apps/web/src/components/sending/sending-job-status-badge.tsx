import { Badge } from '@/components/ui/badge';
import type { SendingJobStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  status: SendingJobStatus;
  className?: string;
}

const STYLES: Record<SendingJobStatus, string> = {
  PENDING: 'bg-muted text-muted-foreground',
  SCHEDULED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  PROCESSING: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  RETRYING: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  SENT: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  FAILED: 'bg-red-500/10 text-red-600 dark:text-red-400',
  CANCELLED: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  PAUSED: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
};

export function SendingJobStatusBadge({ status, className }: Props) {
  return (
    <Badge variant="outline" className={cn('border-transparent', STYLES[status], className)}>
      {status}
    </Badge>
  );
}
