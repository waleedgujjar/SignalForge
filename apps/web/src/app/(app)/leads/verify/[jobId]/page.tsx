'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft, Download, XCircle, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';

import {
  cancelVerificationJob,
  fetchVerificationHistory,
  fetchVerificationJob,
  verificationExportUrl,
} from '@/lib/api';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { VerificationStatusBadge } from '@/components/verification/status-badge';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const RUNNING_STATUSES = ['PENDING', 'RUNNING'];

export default function VerificationJobPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);

  const { data: job, isLoading } = useQuery({
    queryKey: ['verification-job', jobId],
    queryFn: () => fetchVerificationJob(jobId),
    refetchInterval: (query) => (RUNNING_STATUSES.includes(query.state.data?.status ?? '') ? 2000 : false),
  });

  const historyParams = useMemo(() => {
    const params: Record<string, string> = { page: String(page), limit: '25', jobId };
    if (search) params.search = search;
    return params;
  }, [page, search, jobId]);

  const { data: history } = useQuery({
    queryKey: ['verification-history', historyParams],
    queryFn: () => fetchVerificationHistory(historyParams),
    enabled: Boolean(job),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelVerificationJob(jobId),
    onSuccess: () => {
      toast.success('Job cancelled');
      void queryClient.invalidateQueries({ queryKey: ['verification-job', jobId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const progress = job && job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0;
  const selected = history?.data.find((entry) => entry.id === selectedEntry) ?? null;

  if (isLoading || !job) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/leads/verify')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <PageHeader title={job.name ?? 'Verification job'} description={`${job.completed} of ${job.total} completed`} />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-4"><div className="text-sm text-muted-foreground">Valid</div><div className="text-2xl font-semibold">{job.validCount}</div></Card>
        <Card className="p-4"><div className="text-sm text-muted-foreground">Risky</div><div className="text-2xl font-semibold">{job.riskyCount}</div></Card>
        <Card className="p-4"><div className="text-sm text-muted-foreground">Invalid</div><div className="text-2xl font-semibold">{job.invalidCount}</div></Card>
        <Card className="p-4"><div className="text-sm text-muted-foreground">Unknown</div><div className="text-2xl font-semibold">{job.unknownCount}</div></Card>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">{job.status}</div>
            <div className="text-sm text-muted-foreground">{job.completed}/{job.total} emails</div>
          </div>
          <div className="flex gap-2">
            {RUNNING_STATUSES.includes(job.status) && (
              <Button variant="outline" size="sm" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                <XCircle className="mr-1 h-4 w-4" /> Cancel
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <a href={verificationExportUrl(jobId)} download>
                <Download className="mr-1 h-4 w-4" /> Export
              </a>
            </Button>
          </div>
        </div>
        <Progress value={progress} />
      </Card>

      <Card className="p-4 space-y-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search emails" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Checked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(history?.data ?? []).map((entry) => (
              <TableRow key={entry.id} className="cursor-pointer" onClick={() => setSelectedEntry(entry.id)}>
                <TableCell>{entry.email}</TableCell>
                <TableCell><VerificationStatusBadge status={entry.status} /></TableCell>
                <TableCell>{entry.riskScore ?? '—'}</TableCell>
                <TableCell>{entry.confidenceScore ?? '—'}</TableCell>
                <TableCell>{new Date(entry.checkedAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selected?.email}</SheetTitle>
            <SheetDescription>Verification diagnostics</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <VerificationStatusBadge status={selected.status} />
              </div>
              <p><span className="text-muted-foreground">Risk score:</span> {selected.riskScore ?? '—'}</p>
              <p><span className="text-muted-foreground">Confidence:</span> {selected.confidenceScore ?? '—'}</p>
              <p><span className="text-muted-foreground">Reason:</span> {selected.reasonMessage ?? '—'}</p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
