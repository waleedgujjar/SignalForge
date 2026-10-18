'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Users, Search, Upload, Download, Trash2, Brain, Globe2,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown,
  MoreHorizontal, X,
} from 'lucide-react';

import {
  fetchLeads, createLead, bulkDeleteLeads,
  fetchTags, fetchLists, batchEnrichLeads, createVerificationBulkJob,
  batchAnalyzeWebsites,
} from '@/lib/api';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import {
  getLeadDisplayName,
  getLeadWebsite,
  formatWebsiteHref,
  formatWebsiteLabel,
  formatPhoneTel,
  formatEmailMailto,
} from '@/lib/lead-display';

const STATUS_LABELS: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', REPLIED: 'Replied',
  QUALIFIED: 'Qualified', UNQUALIFIED: 'Unqualified', CONVERTED: 'Converted',
  UNSUBSCRIBED: 'Unsubscribed', BOUNCED: 'Bounced', ARCHIVED: 'Archived',
};
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  NEW: 'outline', CONTACTED: 'secondary', REPLIED: 'default',
  QUALIFIED: 'default', UNQUALIFIED: 'secondary', CONVERTED: 'default',
  UNSUBSCRIBED: 'destructive', BOUNCED: 'destructive', ARCHIVED: 'secondary',
};


function TableSkeleton() {
  return (
    <Card className="border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Website</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-4" /></TableCell>
              <TableCell><Skeleton className="h-4 w-28" /></TableCell>
              <TableCell><Skeleton className="h-4 w-36" /></TableCell>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
              <TableCell><Skeleton className="h-4 w-4" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default function LeadsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [enrichmentStatusFilter, setEnrichmentStatusFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [listFilter, setListFilter] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAnalyzeConfirm, setShowAnalyzeConfirm] = useState(false);

  const queryParams = useMemo(() => {
    const p: Record<string, string> = { page: String(page), sortBy, sortOrder };
    if (search) p.search = search;
    if (statusFilter) p.status = statusFilter;
    if (sourceFilter) p.source = sourceFilter;
    if (verificationFilter) p.verificationStatus = verificationFilter;
    if (priorityFilter) p.prospectPriority = priorityFilter;
    if (enrichmentStatusFilter) p.enrichmentStatus = enrichmentStatusFilter;
    if (tagFilter) p.tagId = tagFilter;
    if (listFilter) p.listId = listFilter;
    return p;
  }, [search, statusFilter, sourceFilter, verificationFilter, priorityFilter, enrichmentStatusFilter, tagFilter, listFilter, sortBy, sortOrder, page]);

  const { data, isLoading } = useQuery({
    queryKey: ['leads', queryParams],
    queryFn: () => fetchLeads(queryParams),
  });

  const { data: tags } = useQuery({ queryKey: ['tags'], queryFn: fetchTags });
  const { data: lists } = useQuery({ queryKey: ['lists'], queryFn: fetchLists });

  const createMutation = useMutation({
    mutationFn: createLead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setShowForm(false);
      toast.success('Lead created');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: bulkDeleteLeads,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setSelected(new Set());
      setShowDeleteConfirm(false);
      toast.success(`${result.deleted} lead(s) deleted`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const bulkEnrichMutation = useMutation({
    mutationFn: batchEnrichLeads,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setSelected(new Set());
      toast.success(`${result.queued} lead(s) queued for enrichment`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const bulkVerifyMutation = useMutation({
    mutationFn: (leadIds: string[]) =>
      createVerificationBulkJob({ leadIds, source: 'LEADS', name: 'Selected leads verification' }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setSelected(new Set());
      toast.success(`Verification job started (${result.total} emails)`);
      router.push(`/leads/verify/${result.jobId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const bulkAnalyzeMutation = useMutation({
    mutationFn: ({ leadIds, confirmBulk }: { leadIds: string[]; confirmBulk?: boolean }) =>
      batchAnalyzeWebsites({ leadIds, confirmBulk }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['website-analyses'] });
      queryClient.invalidateQueries({ queryKey: ['website-intel-stats'] });
      setSelected(new Set());
      setShowAnalyzeConfirm(false);
      const skippedMsg = result.skipped > 0 ? ` (${result.skipped} skipped — no website)` : '';
      toast.success(`${result.queued} website analysis job(s) queued${skippedMsg}`);
      if (result.queued > 0) router.push('/website-intelligence');
    },
    onError: (err: Error) => toast.error(err.message),
  });


  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const obj: Record<string, unknown> = {};
    form.forEach((val, key) => { if (val) obj[key] = val; });
    createMutation.mutate(obj);
  }

  function toggleSort(field: string) {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!leads.length) return;
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map((l) => l.id)));
    }
  }

  function clearFilters() {
    setSearch('');
    setStatusFilter('');
    setSourceFilter('');
    setVerificationFilter('');
    setPriorityFilter('');
    setEnrichmentStatusFilter('');
    setTagFilter('');
    setListFilter('');
    setPage(1);
  }

  const leads = data?.data ?? [];
  const pagination = data?.pagination;
  const hasFilters = !!(search || statusFilter || sourceFilter || verificationFilter || priorityFilter || enrichmentStatusFilter || tagFilter || listFilter);
  const allSelected = leads.length > 0 && selected.size === leads.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Leads"
        description="Manage your leads database."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('/leads/import')}>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
            <Button variant="outline" asChild>
              <a
                href={`${process.env.NEXT_PUBLIC_API_URL ?? '/api'}/leads/export?${new URLSearchParams(queryParams)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="mr-2 h-4 w-4" />
                Export
              </a>
            </Button>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Lead
            </Button>
          </div>
        }
      />

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search leads..."
            className="pl-9"
          />
        </div>
        <Select value={statusFilter || 'ALL'} onValueChange={(v) => { setStatusFilter(v === 'ALL' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter || 'ALL'} onValueChange={(v) => { setSourceFilter(v === 'ALL' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All sources</SelectItem>
            <SelectItem value="MANUAL">Manual</SelectItem>
            <SelectItem value="CSV_IMPORT">CSV Import</SelectItem>
            <SelectItem value="DISCOVERY">Discovery</SelectItem>
            <SelectItem value="API">API</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>
        <Select value={verificationFilter || 'ALL'} onValueChange={(v) => { setVerificationFilter(v === 'ALL' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Verification" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All verification</SelectItem>
            <SelectItem value="VERIFIED">Verified</SelectItem>
            <SelectItem value="RISKY">Risky</SelectItem>
            <SelectItem value="INVALID">Invalid</SelectItem>
            <SelectItem value="DISPOSABLE">Disposable</SelectItem>
            <SelectItem value="ROLE_BASED">Role-based</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter || 'ALL'} onValueChange={(v) => { setPriorityFilter(v === 'ALL' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All priorities</SelectItem>
            <SelectItem value="VERY_HIGH">Very High</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={enrichmentStatusFilter || 'ALL'} onValueChange={(v) => { setEnrichmentStatusFilter(v === 'ALL' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Enrichment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All enrichment</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="PARTIAL">Partial</SelectItem>
            <SelectItem value="QUEUED">Queued</SelectItem>
            <SelectItem value="ENRICHING">Enriching</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="NOT_ENRICHED">Not Enriched</SelectItem>
          </SelectContent>
        </Select>
        {(tags?.length ?? 0) > 0 && (
          <Select value={tagFilter || 'ALL'} onValueChange={(v) => { setTagFilter(v === 'ALL' ? '' : v); setPage(1); }}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All tags</SelectItem>
              {tags?.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {(lists?.length ?? 0) > 0 && (
          <Select value={listFilter || 'ALL'} onValueChange={(v) => { setListFilter(v === 'ALL' ? '' : v); setPage(1); }}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="List" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All lists</SelectItem>
              {lists?.map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 h-3 w-3" /> Clear
          </Button>
        )}
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => bulkEnrichMutation.mutate(Array.from(selected))} disabled={bulkEnrichMutation.isPending}>
            <Brain className="mr-1 h-3 w-3" /> Enrich
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulkVerifyMutation.mutate(Array.from(selected))} disabled={bulkVerifyMutation.isPending}>
            Verify selected
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (selected.size > 10) setShowAnalyzeConfirm(true);
              else bulkAnalyzeMutation.mutate({ leadIds: Array.from(selected) });
            }}
            disabled={bulkAnalyzeMutation.isPending}
          >
            <Globe2 className="mr-1 h-3 w-3" /> Analyze websites
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
            <Trash2 className="mr-1 h-3 w-3" /> Delete
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      {/* Create Lead Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Lead</DialogTitle>
            <DialogDescription>Fill in the details to create a new lead.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="name@company.com" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" name="firstName" placeholder="John" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" name="lastName" placeholder="Doe" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Company</Label>
                <Input id="company" name="company" placeholder="Acme Inc." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input id="website" name="website" placeholder="https://example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyDomain">Company domain</Label>
                <Input id="companyDomain" name="companyDomain" placeholder="example.com" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="jobTitle">Job title</Label>
                <Input id="jobTitle" name="jobTitle" placeholder="Product Manager" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" placeholder="+1 555-0100" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="linkedinUrl">LinkedIn</Label>
                <Input id="linkedinUrl" name="linkedinUrl" placeholder="linkedin.com/in/..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="countryCode">Country code</Label>
                <Input id="countryCode" name="countryCode" placeholder="US" maxLength={2} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input id="country" name="country" placeholder="United States" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input id="state" name="state" placeholder="California" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input id="city" name="city" placeholder="San Francisco" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving...' : 'Save Lead'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk analyze confirm */}
      <AlertDialog open={showAnalyzeConfirm} onOpenChange={setShowAnalyzeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Analyze {selected.size} websites?</AlertDialogTitle>
            <AlertDialogDescription>
              This will queue website intelligence analysis for all selected leads that have a
              website or company domain. Leads without a website will be skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                bulkAnalyzeMutation.mutate({
                  leadIds: Array.from(selected),
                  confirmBulk: true,
                })
              }
            >
              {bulkAnalyzeMutation.isPending ? 'Starting...' : 'Start analysis'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} lead(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected leads and all their associated data will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkDeleteMutation.mutate(Array.from(selected))}
            >
              {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Content */}
      {isLoading ? (
        <TableSkeleton />
      ) : leads.length === 0 && !hasFilters ? (
        <EmptyState
          icon={Users}
          title="No leads yet"
          description="Get started by adding your first lead or importing a CSV."
          action={{ label: 'Add Lead', onClick: () => setShowForm(true) }}
        />
      ) : leads.length === 0 && hasFilters ? (
        <EmptyState
          icon={Search}
          title="No leads found"
          description="Try adjusting your filters or search terms."
          action={{ label: 'Clear Filters', onClick: clearFilters }}
        />
      ) : (
        <>
          <Card className="border-border overflow-hidden">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} aria-label="Select all" />
                  </TableHead>
                  <TableHead className="w-[18%]">
                    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('firstName')}>
                      Name <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="w-[22%]">
                    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('email')}>
                      Email <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="w-[18%]">
                    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('company')}>
                      Company <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="w-[12%]">Phone</TableHead>
                  <TableHead className="w-[14%]">Website</TableHead>
                  <TableHead className="w-[8%]">
                    <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('status')}>
                      Status <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => {
                  return (
                    <TableRow
                      key={lead.id}
                      className="cursor-pointer"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('button, input, [role="checkbox"]')) return;
                        router.push(`/leads/${lead.id}`);
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(lead.id)}
                          onCheckedChange={() => toggleSelect(lead.id)}
                          aria-label={`Select ${lead.email}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium truncate">
                        {getLeadDisplayName(lead) ?? <span className="text-muted-foreground/60">—</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground truncate">
                        {(() => {
                          const mailto = formatEmailMailto(lead.email);
                          if (!mailto) {
                            return <span className="italic text-muted-foreground/60">(no email)</span>;
                          }
                          return (
                            <a
                              href={`mailto:${mailto}`}
                              className="hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {mailto}
                            </a>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="truncate">{lead.company ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {lead.phone ? (() => {
                          const tel = formatPhoneTel(lead.phone);
                          return tel ? (
                            <a
                              href={`tel:${tel}`}
                              className="hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {lead.phone}
                            </a>
                          ) : lead.phone;
                        })() : '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {(() => {
                          const website = getLeadWebsite(lead);
                          if (!website) return '—';
                          return (
                            <a
                              href={formatWebsiteHref(website)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline truncate max-w-[160px] block"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {formatWebsiteLabel(website)} ↗
                            </a>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[lead.status] ?? 'secondary'}>
                          {STATUS_LABELS[lead.status] ?? lead.status}
                        </Badge>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push(`/leads/${lead.id}`)}>
                              View details
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => { setSelected(new Set([lead.id])); setShowDeleteConfirm(true); }}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(pagination.page - 1) * pagination.limit + 1}–
                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(1)}>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-3 text-sm">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(pagination.totalPages)}>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
