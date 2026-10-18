'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { History, Plus, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { fetchDiscoveryJobs, cancelDiscoveryJob, retryDiscoveryJob } from '@/lib/api';
import { sourceLabel, formatDuration } from '@/lib/discovery-display';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'COMPLETED') return 'default';
  if (status === 'FAILED' || status === 'CANCELLED') return 'destructive';
  if (status === 'PARTIAL') return 'outline';
  return 'secondary';
}

export default function DiscoveryHistoryPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const params = useMemo(() => {
    const p: Record<string, string> = { page: String(page), limit: '20' };
    if (status) p.status = status;
    return p;
  }, [page, status]);

  const { data, isLoading } = useQuery({
    queryKey: ['discovery-jobs', params],
    queryFn: () => fetchDiscoveryJobs(params),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelDiscoveryJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery-jobs'] });
      toast.success('Discovery cancelled');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const retryMutation = useMutation({
    mutationFn: retryDiscoveryJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery-jobs'] });
      toast.success('Discovery restarted');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const jobs = data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discovery history"
        description="Every discovery run in this workspace."
        actions={
          <Button onClick={() => router.push('/leads/discovery')}>
            <Plus className="mr-2 h-4 w-4" /> New discovery
          </Button>
        }
      />

      <div className="flex items-center gap-3">
        <Select value={status || 'ALL'} onValueChange={(v) => { setStatus(v === 'ALL' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {['PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-border">
        {isLoading ? (
          <div className="space-y-2 p-6">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={History}
            title="No discovery runs yet"
            description="Configure a discovery source or import a CSV/XLSX file to get started."
            action={{ label: 'Discover leads', onClick: () => router.push('/leads/discovery') }}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Search</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Found</TableHead>
                  <TableHead className="text-right">Unique</TableHead>
                  <TableHead className="text-right">Qualified</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const isActive = job.status === 'PENDING' || job.status === 'RUNNING';
                  const canRetry = job.status === 'FAILED' || job.status === 'PARTIAL';
                  return (
                    <TableRow
                      key={job.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/leads/discovery/${job.id}`)}
                    >
                      <TableCell className="font-medium">
                        {job.name ?? (job.query?.industry as string) ?? 'Untitled search'}
                        <div className="text-xs text-muted-foreground">
                          {[job.query?.city, job.query?.state, job.query?.country].filter(Boolean).join(', ')}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline">{sourceLabel(job.source)}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{job.discoveredCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{job.uniqueCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{job.qualifiedCount}</TableCell>
                      <TableCell><Badge variant={statusVariant(job.status)}>{job.status}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div>{new Date(job.createdAt).toLocaleDateString()}</div>
                        {job.completedAt && job.startedAt && (
                          <div className="text-xs">{formatDuration(job.startedAt, job.completedAt)}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          {isActive && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => cancelMutation.mutate(job.id)}
                              disabled={cancelMutation.isPending}
                              aria-label="Cancel"
                            >
                              {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                            </Button>
                          )}
                          {canRetry && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => retryMutation.mutate(job.id)}
                              disabled={retryMutation.isPending}
                              aria-label="Retry"
                            >
                              {retryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {data && data.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border p-4">
            <p className="text-sm text-muted-foreground">
              {data.pagination.total} discovery run{data.pagination.total === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
