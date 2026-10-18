import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SendingJobStatusBadge } from './sending-job-status-badge';
import { cancelSendingJob, retrySendingJob, type SendingJob } from '@/lib/api';

interface Props {
  jobs: SendingJob[];
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const NON_RETRYABLE = new Set(['AUTH', 'PERMANENT', 'BOUNCE', 'INVALID_ADDRESS']);

export function QueueJobTable({ jobs }: Props) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sending-jobs'] });
    queryClient.invalidateQueries({ queryKey: ['queue-stats'] });
  };

  const retryMutation = useMutation({
    mutationFn: (id: string) => retrySendingJob(id),
    onSuccess: () => {
      toast.success('Job queued for retry');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelSendingJob(id),
    onSuccess: () => {
      toast.success('Job cancelled');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lead</TableHead>
          <TableHead>Campaign</TableHead>
          <TableHead>Step</TableHead>
          <TableHead>Mailbox</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Scheduled</TableHead>
          <TableHead>Attempts</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => {
          const retryable = job.status === 'FAILED' && !NON_RETRYABLE.has(job.errorCategory ?? '');
          const cancellable = ['PENDING', 'SCHEDULED', 'RETRYING', 'PAUSED'].includes(job.status);
          return (
            <TableRow key={job.id}>
              <TableCell>
                <div className="font-medium">{job.lead?.email ?? job.leadId}</div>
                {job.lead?.company && (
                  <div className="text-xs text-muted-foreground">{job.lead.company}</div>
                )}
              </TableCell>
              <TableCell>{job.campaign?.name ?? job.campaignId}</TableCell>
              <TableCell>#{(job.step?.order ?? 0) + 1}</TableCell>
              <TableCell>{job.mailbox?.emailAddress ?? '—'}</TableCell>
              <TableCell>
                <SendingJobStatusBadge status={job.status} />
                {job.errorCategory && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    {job.errorCategory}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(job.scheduledAt)}
              </TableCell>
              <TableCell>
                {job.attempts}/{job.maxAttempts}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {retryable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={retryMutation.isPending}
                      onClick={() => retryMutation.mutate(job.id)}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" /> Retry
                    </Button>
                  )}
                  {cancellable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(job.id)}
                    >
                      <XCircle className="mr-1 h-3 w-3" /> Cancel
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
