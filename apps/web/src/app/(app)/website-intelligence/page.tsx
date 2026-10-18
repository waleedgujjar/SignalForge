'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Globe2, TrendingUp, AlertTriangle, BarChart3, Loader2, Plus } from 'lucide-react';

import {
  fetchWebsiteAnalyses,
  fetchWebsiteIntelStats,
  type AnalysisStatus,
  type OpportunityPriority,
} from '@/lib/api';
import { StatCard } from '@/components/dashboard/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

function statusBadge(status: AnalysisStatus) {
  switch (status) {
    case 'COMPLETED': return <Badge variant="default" className="bg-green-600">Completed</Badge>;
    case 'CRAWLING': return <Badge variant="secondary">Crawling</Badge>;
    case 'ANALYZING': return <Badge variant="secondary">Analyzing</Badge>;
    case 'PENDING': return <Badge variant="outline">Pending</Badge>;
    case 'FAILED': return <Badge variant="destructive">Failed</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function priorityBadge(priority: OpportunityPriority | null) {
  if (!priority) return <span className="text-muted-foreground text-sm">—</span>;
  switch (priority) {
    case 'VERY_HIGH': return <Badge variant="destructive">Very High</Badge>;
    case 'HIGH': return <Badge className="bg-orange-500">High</Badge>;
    case 'MEDIUM': return <Badge variant="secondary">Medium</Badge>;
    case 'LOW': return <Badge variant="outline">Low</Badge>;
  }
}

function scoreBar(score: number | null) {
  if (score === null) return <span className="text-muted-foreground text-sm">—</span>;
  const color = score >= 70 ? 'bg-green-500' : score >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-medium">{score}</span>
    </div>
  );
}

export default function WebsiteIntelligencePage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  const params: Record<string, string> = { page: String(page), limit: '20' };
  if (statusFilter !== 'all') params['status'] = statusFilter;
  if (priorityFilter !== 'all') params['opportunityPriority'] = priorityFilter;

  const { data: statsData } = useQuery({
    queryKey: ['website-intel-stats'],
    queryFn: fetchWebsiteIntelStats,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['website-analyses', page, statusFilter, priorityFilter],
    queryFn: () => fetchWebsiteAnalyses(params),
    refetchInterval: (query) => {
      const items = query.state.data?.analyses ?? [];
      return items.some((a) => ['PENDING', 'CRAWLING', 'ANALYZING'].includes(a.status))
        ? 3000
        : false;
    },
  });

  const analyses = data?.analyses ?? [];
  const pagination = data?.pagination;
  const hasInProgress = analyses.some((a) => ['PENDING', 'CRAWLING', 'ANALYZING'].includes(a.status));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Website Intelligence</h1>
        <Button asChild>
          <Link href="/website-intelligence/studio">
            <Plus className="mr-2 h-4 w-4" />
            Analyze Website
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Websites Analyzed" value={statsData?.totalAnalyzed ?? 0} icon={Globe2} />
        <StatCard title="Avg Website Score" value={statsData?.avgWebsiteScore ?? 0} description="out of 100" icon={BarChart3} />
        <StatCard title="Avg Opportunity Score" value={statsData?.avgOpportunityScore ?? 0} description="out of 100" icon={TrendingUp} />
        <StatCard
          title="High Priority Leads"
          value={(statsData?.priorityDistribution?.['HIGH'] ?? 0) + (statsData?.priorityDistribution?.['VERY_HIGH'] ?? 0)}
          icon={AlertTriangle}
        />
      </div>

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="CRAWLING">Crawling</SelectItem>
            <SelectItem value="ANALYZING">Analyzing</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={(v) => { setPriorityFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="VERY_HIGH">Very High</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : analyses.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <Globe2 className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-1">No website analyses yet.</p>
          <p className="text-xs text-muted-foreground mb-4">
            Analyze any website by URL, or start from a lead&apos;s detail page.
          </p>
          <Button asChild>
            <Link href="/website-intelligence/studio">
              <Plus className="mr-2 h-4 w-4" />
              Analyze Website
            </Link>
          </Button>
        </div>
      ) : (
        <>
          {hasInProgress && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analysis in progress — this page refreshes automatically.
            </p>
          )}
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Website Score</TableHead>
                  <TableHead>Opportunity</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analyses.map((a) => (
                  <TableRow
                    key={a.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/website-intelligence/${a.id}`)}
                  >
                    <TableCell className="font-medium">{a.domain}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.lead?.fullName || a.lead?.email || '—'}
                    </TableCell>
                    <TableCell>{scoreBar(a.websiteScore)}</TableCell>
                    <TableCell>{scoreBar(a.opportunityScore)}</TableCell>
                    <TableCell>{priorityBadge(a.opportunityPriority)}</TableCell>
                    <TableCell>{statusBadge(a.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(a.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} analyses)
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
