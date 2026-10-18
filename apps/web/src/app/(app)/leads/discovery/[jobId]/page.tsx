'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useCallback, Suspense } from 'react';
import {
  ArrowLeft, Download, Save, Send, RefreshCw, XCircle, Globe, Phone,
  ShieldCheck, ShieldAlert, Radar, Loader2, Search, ArrowUpDown, Mail,
  MapPin, Briefcase, ExternalLink, CheckCircle2, XOctagon, HelpCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  cancelDiscoveryJob, discoveryExportUrl, enrollDiscoveredLeads, fetchCampaigns,
  fetchDiscoveryJob, fetchDiscoveryResults, retryDiscoveryJob, saveDiscoveredLeads,
  type DiscoveredLead,
} from '@/lib/api';
import { sourceLabel, formatDuration } from '@/lib/discovery-display';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const RUNNING_STATUSES = ['PENDING', 'RUNNING'];

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'COMPLETED') return 'default';
  if (status === 'FAILED' || status === 'CANCELLED') return 'destructive';
  if (status === 'PARTIAL') return 'outline';
  return 'secondary';
}

function emailBadge(lead: DiscoveredLead) {
  if (!lead.email) return <span className="text-xs text-muted-foreground">No email</span>;

  const inferred = lead.emailSource === 'PATTERN_INFERRED';
  return (
    <div className="flex items-center gap-1.5">
      <a href={`mailto:${lead.email}`} className="truncate text-sm hover:underline" onClick={(e) => e.stopPropagation()}>
        {lead.email}
      </a>
      {inferred ? (
        <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700">
          <ShieldAlert className="h-3 w-3" /> Guessed
        </Badge>
      ) : lead.emailStatus === 'VERIFIED' ? (
        <Badge variant="secondary" className="gap-1">
          <ShieldCheck className="h-3 w-3" /> Verified
        </Badge>
      ) : lead.emailStatus ? (
        <Badge variant="outline">{lead.emailStatus}</Badge>
      ) : null}
    </div>
  );
}

const SORT_OPTIONS = [
  { value: 'icpFitScore', label: 'Score' },
  { value: 'company', label: 'Company' },
  { value: 'email', label: 'Email' },
  { value: 'createdAt', label: 'Date' },
] as const;

const EMAIL_STATUS_OPTIONS = [
  { value: 'VERIFIED', label: 'Verified' },
  { value: 'RISKY', label: 'Risky' },
  { value: 'INVALID', label: 'Invalid' },
  { value: 'UNKNOWN', label: 'Unknown' },
  { value: 'DISPOSABLE', label: 'Disposable' },
  { value: 'ROLE_BASED', label: 'Role-based' },
] as const;

function LeadDetailSheet({
  lead,
  onClose,
  onSave,
  saving,
}: {
  lead: DiscoveredLead;
  onClose: () => void;
  onSave: (id: string) => void;
  saving: boolean;
}) {
  const signals = lead.qualificationSignals ?? [];

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>{lead.company ?? 'Lead Details'}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Contact */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Briefcase className="h-3.5 w-3.5" /> Contact
            </h3>
            <div className="grid gap-2 text-sm">
              {lead.fullName && (
                <div><span className="text-muted-foreground">Name:</span> {lead.fullName}</div>
              )}
              {lead.jobTitle && (
                <div><span className="text-muted-foreground">Title:</span> {lead.jobTitle}</div>
              )}
              {lead.industry && (
                <div><span className="text-muted-foreground">Industry:</span> {lead.industry}</div>
              )}
            </div>
          </section>

          <Separator />

          {/* Email */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Mail className="h-3.5 w-3.5" /> Email
            </h3>
            <div className="space-y-2 text-sm">
              {lead.email ? (
                <>
                  <div className="flex items-center gap-2">
                    <a href={`mailto:${lead.email}`} className="hover:underline">{lead.email}</a>
                    {lead.emailSource === 'PATTERN_INFERRED' ? (
                      <Badge variant="outline" className="border-amber-300 text-amber-700">Guessed</Badge>
                    ) : lead.emailStatus === 'VERIFIED' ? (
                      <Badge variant="secondary">Verified</Badge>
                    ) : lead.emailStatus ? (
                      <Badge variant="outline">{lead.emailStatus}</Badge>
                    ) : null}
                  </div>
                  {lead.emailSource && (
                    <div className="text-xs text-muted-foreground">Source: {lead.emailSource.replace(/_/g, ' ').toLowerCase()}</div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">No email found</p>
              )}
            </div>
          </section>

          <Separator />

          {/* Phone & Website */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Globe className="h-3.5 w-3.5" /> Contact Info
            </h3>
            <div className="grid gap-2 text-sm">
              {lead.phone ? (
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  <a href={`tel:${lead.phone}`} className="hover:underline">{lead.phone}</a>
                </div>
              ) : (
                <div className="text-muted-foreground">No phone</div>
              )}
              {lead.normalizedDomain ? (
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  <a
                    href={`https://${lead.normalizedDomain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {lead.normalizedDomain}
                    <ExternalLink className="ml-1 inline h-3 w-3" />
                  </a>
                </div>
              ) : (
                <div className="text-muted-foreground">No website</div>
              )}
            </div>
          </section>

          <Separator />

          {/* Location */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> Location
            </h3>
            <div className="text-sm">
              {[lead.city, lead.state, lead.country].filter(Boolean).join(', ') || (
                <span className="text-muted-foreground">Unknown</span>
              )}
            </div>
          </section>

          <Separator />

          {/* Qualification */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Qualification
            </h3>
            <div className="flex items-center gap-3">
              <div className="text-3xl font-bold tabular-nums">{lead.icpFitScore ?? '—'}</div>
              <div>
                {lead.qualified ? (
                  <Badge>Qualified</Badge>
                ) : (
                  <Badge variant="outline">Not qualified</Badge>
                )}
                {lead.qualifyReason && (
                  <p className="mt-1 text-xs text-muted-foreground">{lead.qualifyReason}</p>
                )}
              </div>
            </div>

            {signals.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Signals</p>
                <div className="space-y-1">
                  {signals.map((signal, i) => {
                    const icon = signal.status === 'passed'
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      : signal.status === 'failed'
                        ? <XOctagon className="h-3.5 w-3.5 text-red-500" />
                        : <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />;
                    return (
                      <div key={i} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5 text-sm">
                        <div className="flex items-center gap-2">
                          {icon}
                          <span>{signal.dimension}</span>
                        </div>
                        <span className="tabular-nums text-muted-foreground">{signal.score}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <Separator />

          {/* Meta */}
          <section className="space-y-2 text-sm text-muted-foreground">
            <div>Source: {sourceLabel(lead.source)}</div>
            {lead.sourceUrl && (
              <div>
                <a href={lead.sourceUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  Source listing <ExternalLink className="ml-1 inline h-3 w-3" />
                </a>
              </div>
            )}
            <div>Discovered: {new Date(lead.createdAt).toLocaleString()}</div>
          </section>

          {/* Actions */}
          {!lead.promotedLeadId && (
            <>
              <Separator />
              <Button
                className="w-full"
                onClick={() => onSave(lead.id)}
                disabled={saving}
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save to leads
              </Button>
            </>
          )}
          {lead.promotedLeadId && (
            <>
              <Separator />
              <Badge variant="secondary" className="w-full justify-center py-2">Already saved</Badge>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DiscoveryJobPageInner() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // URL-persisted filter/sort state
  const page = Number(searchParams.get('page') ?? '1');
  const search = searchParams.get('search') ?? '';
  const qualifiedOnly = searchParams.get('qualified') === 'true';
  const emailStatus = searchParams.get('emailStatus') ?? '';
  const sortBy = searchParams.get('sortBy') ?? 'icpFitScore';
  const sortOrder = (searchParams.get('sortOrder') ?? 'desc') as 'asc' | 'desc';

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    router.replace(`?${next.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const [selectedLead, setSelectedLead] = useState<DiscoveredLead | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollStep, setEnrollStep] = useState<'select' | 'preview'>('select');
  const [campaignId, setCampaignId] = useState('');

  const { data: job, isLoading: jobLoading } = useQuery({
    queryKey: ['discovery-job', jobId],
    queryFn: () => fetchDiscoveryJob(jobId),
    refetchInterval: (query) => (RUNNING_STATUSES.includes(query.state.data?.status ?? '') ? 2000 : false),
  });

  const resultParams = useMemo(() => {
    const p: Record<string, string> = { page: String(page), limit: '25' };
    if (search) p.search = search;
    if (qualifiedOnly) p.qualified = 'true';
    if (emailStatus) p.emailStatus = emailStatus;
    p.sortBy = sortBy;
    p.sortOrder = sortOrder;
    return p;
  }, [page, search, qualifiedOnly, emailStatus, sortBy, sortOrder]);

  const { data: results, isLoading: resultsLoading } = useQuery({
    queryKey: ['discovery-results', jobId, job?.status, resultParams],
    queryFn: () => fetchDiscoveryResults(jobId, resultParams),
    enabled: Boolean(job),
    refetchInterval: RUNNING_STATUSES.includes(job?.status ?? '') ? 3000 : false,
  });

  const { data: campaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => fetchCampaigns(),
    enabled: showEnroll,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['discovery-job', jobId] });
    void queryClient.invalidateQueries({ queryKey: ['discovery-results', jobId] });
  };

  const saveMutation = useMutation({
    mutationFn: (ids: string[]) => saveDiscoveredLeads(jobId, ids),
    onSuccess: (result) => {
      setSelected(new Set());
      setSelectedLead(null);
      invalidate();
      toast.success(`Saved ${result.promoted} lead(s) — ${result.created} new, ${result.updated} merged`);
      if (result.skipped.length > 0) {
        toast.warning(`${result.skipped.length} skipped: ${result.skipped[0]?.reason ?? ''}`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const enrollMutation = useMutation({
    mutationFn: (ids: string[]) => enrollDiscoveredLeads(jobId, { discoveredLeadIds: ids, campaignId }),
    onSuccess: (result) => {
      setSelected(new Set());
      setShowEnroll(false);
      setEnrollStep('select');
      invalidate();
      if (result.enrollment.queued) {
        toast.success(`${result.enrollment.leadCount} lead(s) queued for enrollment`);
      } else {
        toast.success(`Enrolled ${result.enrollment.enrolled} lead(s)`);
        if (result.enrollment.skipped > 0) {
          toast.warning(`${result.enrollment.skipped} skipped by campaign rules`);
        }
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelDiscoveryJob(jobId),
    onSuccess: () => { invalidate(); toast.success('Discovery cancelled'); },
    onError: (error: Error) => toast.error(error.message),
  });

  const retryMutation = useMutation({
    mutationFn: () => retryDiscoveryJob(jobId),
    onSuccess: () => { invalidate(); toast.success('Discovery restarted'); },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = results?.data ?? [];
  const isRunning = RUNNING_STATUSES.includes(job?.status ?? '');

  const enrollPreview = useMemo(() => {
    const selectedLeads = rows.filter((r) => selected.has(r.id));
    const withEmail = selectedLeads.filter((r) => r.email).length;
    const verified = selectedLeads.filter((r) => r.emailStatus === 'VERIFIED').length;
    return {
      total: selectedLeads.length,
      withEmail,
      verified,
      noEmail: selectedLeads.length - withEmail,
    };
  }, [rows, selected]);
  const progress = job && job.requestedCount > 0
    ? Math.min(100, Math.round((job.discoveredCount / job.requestedCount) * 100))
    : 0;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  function handleSort(field: string) {
    if (sortBy === field) {
      updateParams({ sortOrder: sortOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      updateParams({ sortBy: field, sortOrder: 'desc', page: null });
    }
  }

  if (jobLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!job) {
    return <EmptyState icon={Radar} title="Discovery job not found" description="It may have been deleted." />;
  }

  const jobQuery = job.query as Record<string, unknown> | null;

  const stats: Array<[string, number]> = [
    ['Found', job.discoveredCount],
    ['Unique', job.uniqueCount],
    ['Duplicates', job.duplicateCount],
    ['Emails', job.emailsFoundCount],
    ['Verified', job.emailsVerifiedCount],
    ['Qualified', job.qualifiedCount],
    ['Saved', job.promotedCount],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={job.name ?? `Discovery — ${sourceLabel(job.source)}`}
        description={`Started ${new Date(job.createdAt).toLocaleString()}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => router.push('/leads/discovery')}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            {isRunning && (
              <Button variant="outline" size="sm" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
                <XCircle className="mr-2 h-4 w-4" /> Cancel
              </Button>
            )}
            {(job.status === 'FAILED' || job.status === 'PARTIAL') && (
              <Button variant="outline" size="sm" onClick={() => retryMutation.mutate()} disabled={retryMutation.isPending}>
                <RefreshCw className="mr-2 h-4 w-4" /> Retry
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <a href={discoveryExportUrl(jobId, 'csv')}><Download className="mr-2 h-4 w-4" /> CSV</a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={discoveryExportUrl(jobId, 'xlsx')}><Download className="mr-2 h-4 w-4" /> XLSX</a>
            </Button>
          </div>
        }
      />

      {/* Status + Stats */}
      <Card className="border-border p-6">
        <div className="mb-4 flex items-center justify-between">
          <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
          {isRunning && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Processing…
            </span>
          )}
        </div>

        {isRunning && <Progress value={progress} className="mb-6" />}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {stats.map(([label, value]) => (
            <div key={label}>
              <p className="text-2xl font-semibold tabular-nums">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {job.error && (
          <p className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{job.error}</p>
        )}
      </Card>

      {/* Job Metadata */}
      {jobQuery && (() => {
        const industry = jobQuery.industry ? String(jobQuery.industry) : '';
        const city = jobQuery.city ? String(jobQuery.city) : '';
        const state = jobQuery.state ? String(jobQuery.state) : '';
        const country = jobQuery.country ? String(jobQuery.country) : '';
        return (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
            {industry && <span>Industry: <strong className="text-foreground">{industry}</strong></span>}
            {city && <span>City: <strong className="text-foreground">{city}</strong></span>}
            {state && <span>State: <strong className="text-foreground">{state}</strong></span>}
            {country && <span>Country: <strong className="text-foreground">{country}</strong></span>}
            <span>Source: <strong className="text-foreground">{sourceLabel(job.source)}</strong></span>
            {job.completedAt && job.startedAt && (
              <span>Duration: <strong className="text-foreground">{formatDuration(job.startedAt, job.completedAt)}</strong></span>
            )}
          </div>
        );
      })()}

      {/* Filters & Sort */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search company, email or domain…"
            className="pl-9"
            value={search}
            onChange={(e) => updateParams({ search: e.target.value, page: null })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={qualifiedOnly}
            onCheckedChange={(c) => updateParams({ qualified: c === true ? 'true' : null, page: null })}
          />
          Qualified only
        </label>
        <Select
          value={emailStatus || 'ALL'}
          onValueChange={(v) => updateParams({ emailStatus: v === 'ALL' ? null : v, page: null })}
        >
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Email status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All emails</SelectItem>
            {EMAIL_STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(v) => updateParams({ sortBy: v, page: null })}
        >
          <SelectTrigger className="w-[130px]"><SelectValue placeholder="Sort by" /></SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => updateParams({ sortOrder: sortOrder === 'asc' ? 'desc' : 'asc' })}
          aria-label={`Sort ${sortOrder === 'asc' ? 'descending' : 'ascending'}`}
        >
          <ArrowUpDown className="h-4 w-4" />
          {sortOrder === 'asc' ? 'Asc' : 'Desc'}
        </Button>
      </div>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-medium">{selected.size} selected</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => saveMutation.mutate([...selected])} disabled={saveMutation.isPending}>
              <Save className="mr-2 h-4 w-4" /> Save to leads
            </Button>
            <Button size="sm" onClick={() => setShowEnroll(true)}>
              <Send className="mr-2 h-4 w-4" /> Add to campaign
            </Button>
          </div>
        </Card>
      )}

      {/* Results Table */}
      <Card className="border-border">
        {resultsLoading ? (
          <div className="space-y-2 p-6">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Radar}
            title={isRunning ? 'Discovery in progress' : 'No leads match your criteria'}
            description={
              isRunning
                ? 'Results appear here as they are processed.'
                : job.source === 'CSV' || job.source === 'XLSX'
                  ? job.failedCount > 0
                    ? `${job.failedCount} row(s) were skipped — check column mapping on the import screen and ensure at least one column maps to company, email, website, phone, or name. Turn off "Qualified only" if it is enabled.`
                    : 'No rows were imported. Re-upload your file, map columns, then import again.'
                  : 'Try relaxing the filters, or lower the minimum qualification score.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size === rows.length && rows.length > 0}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>
                    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort('company')}>
                      Company {sortBy === 'company' && <ArrowUpDown className="h-3 w-3" />}
                    </button>
                  </TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>
                    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => handleSort('email')}>
                      Email {sortBy === 'email' && <ArrowUpDown className="h-3 w-3" />}
                    </button>
                  </TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">
                    <button className="ml-auto flex items-center gap-1 hover:text-foreground" onClick={() => handleSort('icpFitScore')}>
                      Score {sortBy === 'icpFitScore' && <ArrowUpDown className="h-3 w-3" />}
                    </button>
                  </TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className={`cursor-pointer ${lead.isDuplicate ? 'opacity-60' : ''}`}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button, input, a, [role="checkbox"]')) return;
                      setSelectedLead(lead);
                    }}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(lead.id)} onCheckedChange={() => toggleSelect(lead.id)} aria-label={`Select ${lead.company ?? 'lead'}`} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{lead.company ?? '—'}</div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {lead.normalizedDomain && (
                          <a
                            href={`https://${lead.normalizedDomain}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Globe className="h-3 w-3" />{lead.normalizedDomain}
                          </a>
                        )}
                        {lead.phone && (
                          <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{lead.phone}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{lead.fullName ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{lead.jobTitle ?? ''}</div>
                    </TableCell>
                    <TableCell className="max-w-[260px]">{emailBadge(lead)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[lead.city, lead.state, lead.country].filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{lead.icpFitScore ?? '—'}</TableCell>
                    <TableCell>
                      {lead.isDuplicate ? (
                        <Badge variant="outline" title={lead.matchReason ?? undefined}>Duplicate</Badge>
                      ) : lead.promotedLeadId ? (
                        <Badge variant="secondary">Saved</Badge>
                      ) : lead.qualified ? (
                        <Badge>Qualified</Badge>
                      ) : (
                        <Badge variant="outline" title={lead.qualifyReason ?? undefined}>Not qualified</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {results && results.pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border p-4">
            <p className="text-sm text-muted-foreground">
              Showing {(results.pagination.page - 1) * results.pagination.limit + 1}–
              {Math.min(results.pagination.page * results.pagination.limit, results.pagination.total)} of{' '}
              {results.pagination.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateParams({ page: String(page - 1) })}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= results.pagination.totalPages}
                onClick={() => updateParams({ page: String(page + 1) })}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Lead Detail Sheet */}
      {selectedLead && (
        <LeadDetailSheet
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onSave={(id) => saveMutation.mutate([id])}
          saving={saveMutation.isPending}
        />
      )}

      {/* Campaign Enrollment Dialog */}
      <Dialog open={showEnroll} onOpenChange={(open) => { setShowEnroll(open); if (!open) setEnrollStep('select'); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to campaign</DialogTitle>
            <DialogDescription>
              {selected.size} lead(s) will be saved first, then enrolled. Suppressed, unsubscribed,
              bounced and already-enrolled leads are skipped automatically by the campaign rules.
            </DialogDescription>
          </DialogHeader>

          {enrollStep === 'select' && (
            <>
              <div className="space-y-2">
                <Select value={campaignId} onValueChange={setCampaignId}>
                  <SelectTrigger><SelectValue placeholder="Choose a campaign" /></SelectTrigger>
                  <SelectContent>
                    {(campaigns?.data ?? []).map((campaign) => (
                      <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowEnroll(false)}>Cancel</Button>
                <Button
                  disabled={!campaignId}
                  onClick={() => setEnrollStep('preview')}
                >
                  Review eligibility
                </Button>
              </DialogFooter>
            </>
          )}

          {enrollStep === 'preview' && (
            <>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border p-3 text-center">
                    <p className="text-2xl font-semibold tabular-nums">{enrollPreview.total}</p>
                    <p className="text-xs text-muted-foreground">Total selected</p>
                  </div>
                  <div className="rounded-md border border-border p-3 text-center">
                    <p className="text-2xl font-semibold tabular-nums text-emerald-600">{enrollPreview.withEmail}</p>
                    <p className="text-xs text-muted-foreground">With email</p>
                  </div>
                  <div className="rounded-md border border-border p-3 text-center">
                    <p className="text-2xl font-semibold tabular-nums text-emerald-600">{enrollPreview.verified}</p>
                    <p className="text-xs text-muted-foreground">Verified</p>
                  </div>
                  <div className="rounded-md border border-border p-3 text-center">
                    <p className="text-2xl font-semibold tabular-nums text-amber-600">{enrollPreview.noEmail}</p>
                    <p className="text-xs text-muted-foreground">Missing email</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Suppression and duplicate enrollment checks run server-side during enrollment.
                  Leads without an email address will be skipped.
                </p>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setEnrollStep('select')}>Back</Button>
                <Button
                  disabled={enrollMutation.isPending || enrollPreview.withEmail === 0}
                  onClick={() => enrollMutation.mutate([...selected])}
                >
                  {enrollMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm enrollment ({enrollPreview.withEmail})
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DiscoveryJobPage() {
  return (
    <Suspense fallback={
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    }>
      <DiscoveryJobPageInner />
    </Suspense>
  );
}
