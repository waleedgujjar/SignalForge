'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { QueueFilters, type StatusFilter } from '@/components/sending/queue-filters';
import { QueueJobTable } from '@/components/sending/queue-job-table';
import { QueueStatsCards } from '@/components/sending/queue-stats-cards';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { SendingJobListQuery } from '@/lib/api';
import { fetchQueueStats, fetchSendingJobs } from '@/lib/api';

export default function SendingQueuePage() {
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const filters = useMemo<SendingJobListQuery>(() => {
    return {
      page,
      limit: 50,
      status: status === 'ALL' ? undefined : status,
      search: search || undefined,
    };
  }, [page, status, search]);

  const statsQuery = useQuery({
    queryKey: ['queue-stats'],
    queryFn: fetchQueueStats,
    refetchInterval: 15_000,
  });

  const jobsQuery = useQuery({
    queryKey: ['sending-jobs', filters],
    queryFn: () => fetchSendingJobs(filters),
    refetchInterval: 15_000,
  });

  const totalPages = jobsQuery.data?.pagination.totalPages ?? 1;

  return (
    <>
      <PageHeader
        title="Sending Queue"
        description="Live view of scheduled, in-flight, and completed sending jobs across all campaigns."
      />

      <QueueStatsCards stats={statsQuery.data} isLoading={statsQuery.isLoading} />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <QueueFilters
            status={status}
            onStatusChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            search={search}
            onSearchChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />

          {jobsQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : jobsQuery.data?.data.length === 0 ? (
            <EmptyState
              title="No sending jobs yet"
              description="Launch a campaign with enrolled leads to see sending jobs appear here."
            />
          ) : (
            <>
              <QueueJobTable jobs={jobsQuery.data?.data ?? []} />
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages} — {jobsQuery.data?.pagination.total ?? 0} total jobs
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
