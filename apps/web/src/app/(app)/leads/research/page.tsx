'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Info, Loader2, Play, SearchCheck, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/dashboard/empty-state';
import { PageHeader } from '@/components/dashboard/page-header';
import { ManualVerificationDialog } from '@/components/research/manual-verification-dialog';
import {
  ResearchQueueFilters,
  type ResearchQueueStatusFilter,
} from '@/components/research/research-queue-filters';
import { ResearchQueueStats } from '@/components/research/research-queue-stats';
import { ResearchQueueTable } from '@/components/research/research-queue-table';
import { RESEARCH_QUERY_KEYS, invalidateResearchQueries } from '@/components/research/research-status';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  approveResearch,
  fetchResearchProviderStatus,
  fetchResearchQueue,
  fetchResearchStats,
  type LeadResearch,
  type ResearchQueueItem,
  type ResearchQueueQuery,
} from '@/lib/api';

export default function ResearchQueuePage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ResearchQueueStatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [dialogResearch, setDialogResearch] = useState<LeadResearch | null>(null);

  const filters = useMemo<ResearchQueueQuery>(() => {
    return {
      page,
      limit: 50,
      status: status === 'ALL' ? undefined : status,
      search: search || undefined,
    };
  }, [page, status, search]);

  const statusQuery = useQuery({
    queryKey: RESEARCH_QUERY_KEYS.providerStatus,
    queryFn: fetchResearchProviderStatus,
    retry: false,
    staleTime: 60_000,
  });
  const providerStatus = statusQuery.data;
  const enabled = providerStatus?.status === 'ok';

  const statsQuery = useQuery({
    queryKey: RESEARCH_QUERY_KEYS.stats,
    queryFn: fetchResearchStats,
    refetchInterval: 15_000,
    enabled,
  });

  const queueQuery = useQuery({
    queryKey: [...RESEARCH_QUERY_KEYS.queue, filters],
    queryFn: () => fetchResearchQueue(filters),
    refetchInterval: 15_000,
    enabled,
  });

  const approveMutation = useMutation({
    mutationFn: (researchIds: string[]) => approveResearch({ researchIds }),
    onSuccess: (result) => {
      const parts = [`${result.queued} queued`];
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      if (result.capped) parts.push(`capped at ${result.limit} per batch`);
      toast.success(`Approved — ${parts.join(', ')}`);
      setSelectedIds(new Set());
      invalidateResearchQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['lead-research'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const items = queueQuery.data?.data ?? [];
  const totalPages = queueQuery.data?.pagination.totalPages ?? 1;

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(() => {
      if (!checked) return new Set();
      return new Set(items.filter((item) => item.status === 'PENDING').map((item) => item.id));
    });
  }

  function openEnterData(item: ResearchQueueItem) {
    setDialogResearch(item);
  }

  const selectedCount = selectedIds.size;

  return (
    <>
      <PageHeader
        title="Research Queue"
        description="LinkedIn research that needs a person: suggestions awaiting approval, manual reviews, and failed runs."
        actions={
          enabled ? (
            <Button
              size="sm"
              disabled={selectedCount === 0 || approveMutation.isPending}
              onClick={() => approveMutation.mutate(Array.from(selectedIds))}
            >
              {approveMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-1 h-4 w-4" />
              )}
              Approve selected ({selectedCount})
            </Button>
          ) : undefined
        }
      />

      {statusQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : statusQuery.isError || !providerStatus || providerStatus.status === 'unavailable' ? (
        <Alert>
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Research service is unreachable</AlertTitle>
          <AlertDescription>The queue will load once the API responds. No actions are available meanwhile.</AlertDescription>
        </Alert>
      ) : providerStatus.status === 'disabled' ? (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>LinkedIn research is disabled</AlertTitle>
          <AlertDescription>
            This deployment has the Lead Research module switched off (<code className="text-xs">LINKEDIN_RESEARCH_ENABLED</code>).
            Nothing is fetched and no suggestions are created while it is off. See{' '}
            <Link href="/settings/research" className="font-medium text-primary hover:underline">
              Settings → Research Providers
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <ResearchQueueStats stats={statsQuery.data} isLoading={statsQuery.isLoading} />

          <Card>
            <CardContent className="space-y-4 pt-6">
              <ResearchQueueFilters
                status={status}
                onStatusChange={(v) => {
                  setStatus(v);
                  setPage(1);
                  clearSelection();
                }}
                search={search}
                onSearchChange={(v) => {
                  setSearch(v);
                  setPage(1);
                  clearSelection();
                }}
              />

              {queueQuery.isLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : queueQuery.isError ? (
                <p className="text-sm text-muted-foreground">The queue could not be loaded.</p>
              ) : items.length === 0 ? (
                <EmptyState
                  icon={SearchCheck}
                  title="Nothing needs attention"
                  description="Suggestions from imports, manual reviews and failed runs will appear here. Start research from any lead page."
                />
              ) : (
                <>
                  <ResearchQueueTable
                    items={items}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelect}
                    onToggleAll={toggleAll}
                    onEnterData={openEnterData}
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Page {page} of {totalPages} — {queueQuery.data?.pagination.total ?? 0} total records
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => {
                          setPage((p) => Math.max(1, p - 1));
                          clearSelection();
                        }}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => {
                          setPage((p) => p + 1);
                          clearSelection();
                        }}
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
      )}

      <ManualVerificationDialog
        research={dialogResearch}
        open={dialogResearch !== null}
        onOpenChange={(open) => {
          if (!open) setDialogResearch(null);
        }}
      />
    </>
  );
}
