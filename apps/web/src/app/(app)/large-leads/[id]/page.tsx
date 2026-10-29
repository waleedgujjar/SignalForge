'use client';

import { useMemo, useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Download, FileSpreadsheet, Loader2, Play, Search, Tag as TagIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  fetchStagingDataset,
  fetchStagingProgress,
  startStagingDataset,
  fetchStagedLeads,
  fetchStagingCategories,
  bulkSetStagedCategory,
  transferStagedLeads,
  getStagingExportUrl,
  type StagingDataset,
  type StagedLeadRow,
  type StagedLeadFilterParams,
  type TransferPreview,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const STAGING_FIELDS = ['username', 'name', 'bio', 'category', 'website', 'email', 'phone'] as const;
const FIELD_LABELS: Record<string, string> = {
  username: 'Username', name: 'Name', bio: 'Bio', category: 'Category',
  website: 'Website', email: 'Email', phone: 'Phone Number',
};
const ACTIVE = new Set(['SCANNING', 'PROCESSING']);

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  UNIQUE: 'default', DUPLICATE: 'secondary', REVIEW: 'outline', INVALID: 'destructive',
};

export default function LargeLeadDatasetPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const datasetId = params.id;

  const { data: dataset, isLoading } = useQuery({
    queryKey: ['staging-dataset', datasetId],
    queryFn: () => fetchStagingDataset(datasetId),
    refetchInterval: (q) => (q.state.data && ACTIVE.has(q.state.data.status) ? 2000 : false),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['staging-dataset', datasetId] });
    queryClient.invalidateQueries({ queryKey: ['staged-leads', datasetId] });
    queryClient.invalidateQueries({ queryKey: ['staging-categories', datasetId] });
  };

  if (isLoading || !dataset) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/large-leads')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Large Lead Data
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <h1 className="text-xl font-semibold truncate">{dataset.name}</h1>
        <Badge variant="outline">{dataset.status}</Badge>
      </div>

      {dataset.status === 'PENDING' || dataset.status === 'FAILED' || dataset.status === 'CANCELLED' ? (
        <MappingStep dataset={dataset} onStarted={invalidate} />
      ) : ACTIVE.has(dataset.status) ? (
        <ProcessingView dataset={dataset} />
      ) : (
        <BrowseView dataset={dataset} onChanged={invalidate} />
      )}
    </div>
  );
}

// ─── Step 1: review column mapping + options, then start processing ───────────

function MappingStep({ dataset, onStarted }: { dataset: StagingDataset; onStarted: () => void }) {
  const headers = dataset.config?.headers ?? Object.keys(dataset.columnMappings ?? {});
  const [mappings, setMappings] = useState<Record<string, string>>(dataset.columnMappings ?? {});
  const [aiCategorization, setAiCategorization] = useState(false);

  const startMutation = useMutation({
    mutationFn: () =>
      startStagingDataset(dataset.id, {
        mappings: Object.fromEntries(Object.entries(mappings).filter(([, v]) => v)),
        aiCategorization,
      }),
    onSuccess: () => {
      toast.success('Processing started');
      onStarted();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const mappedCount = Object.values(mappings).filter(Boolean).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Map Columns &amp; Clean</CardTitle>
        <CardDescription>
          {dataset.status === 'FAILED'
            ? 'Processing failed — review the mapping and retry. The uploaded file is retained, and reprocessing starts clean.'
            : 'Match your file columns to the lead fields. Unmapped columns are still kept in each record’s raw data.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {dataset.status === 'FAILED' && dataset.errorLog?.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {dataset.errorLog[0]?.message}
          </div>
        )}

        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File Column</TableHead>
                <TableHead>Map To</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {headers.map((header) => (
                <TableRow key={header}>
                  <TableCell className="font-medium">{header}</TableCell>
                  <TableCell>
                    <Select
                      value={mappings[header] ?? '__skip__'}
                      onValueChange={(v) =>
                        setMappings((prev) => {
                          const next = { ...prev };
                          if (v === '__skip__') delete next[header];
                          else {
                            for (const [h, f] of Object.entries(next)) {
                              if (f === v && h !== header) delete next[h];
                            }
                            next[header] = v;
                          }
                          return next;
                        })
                      }
                    >
                      <SelectTrigger className="w-[220px]">
                        <SelectValue placeholder="Keep in raw data only" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">Keep in raw data only</SelectItem>
                        {STAGING_FIELDS.map((f) => (
                          <SelectItem key={f} value={f}>{FIELD_LABELS[f]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={aiCategorization} onCheckedChange={(v) => setAiCategorization(v === true)} />
          <span>
            Use AI to categorize leads the rules can’t classify
            <span className="block text-xs text-muted-foreground">
              Optional; runs on up to 2,000 uncategorized rows and requires an AI provider configured on the server.
            </span>
          </span>
        </label>

        <div className="flex justify-end">
          <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending || mappedCount === 0}>
            {startMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {dataset.status === 'FAILED' ? 'Retry Processing' : 'Start Processing'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Step 2: live processing progress ─────────────────────────────────────────

function ProcessingView({ dataset }: { dataset: StagingDataset }) {
  const { data: progress } = useQuery({
    queryKey: ['staging-progress', dataset.id],
    queryFn: () => fetchStagingProgress(dataset.id),
    refetchInterval: 2000,
  });
  const p = progress ?? dataset;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cleaning &amp; Categorizing
        </CardTitle>
        <CardDescription>
          Rows are parsed in batches, deduplicated and categorized in the background. You can leave this page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={undefined} className="h-2" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Rows Read" value={p.totalRows} />
          <StatTile label="Staged" value={p.stagedCount} color="green" />
          <StatTile label="Duplicates" value={p.duplicateCount} color="blue" />
          <StatTile label="Errors" value={p.errorCount} color="red" />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Step 3: browse, filter, categorize, import, export ───────────────────────

function BrowseView({ dataset, onChanged }: { dataset: StagingDataset; onChanged: () => void }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [hasEmailFilter, setHasEmailFilter] = useState('');
  const [hasWebsiteFilter, setHasWebsiteFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);
  const [detailRow, setDetailRow] = useState<StagedLeadRow | null>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [mergeStrategy, setMergeStrategy] = useState<'skip' | 'fill_missing'>('skip');
  const [exporting, setExporting] = useState(false);

  const filter: StagedLeadFilterParams = useMemo(() => {
    const f: StagedLeadFilterParams = {};
    if (statusFilter) f.status = statusFilter;
    if (categoryFilter) f.category = categoryFilter;
    if (hasEmailFilter) f.hasEmail = hasEmailFilter;
    if (hasWebsiteFilter) f.hasWebsite = hasWebsiteFilter;
    if (search) f.search = search;
    return f;
  }, [statusFilter, categoryFilter, hasEmailFilter, hasWebsiteFilter, search]);

  const queryParams = useMemo(
    () => ({ page: String(page), limit: '25', ...(filter as Record<string, string>) }),
    [page, filter],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['staged-leads', dataset.id, queryParams],
    queryFn: () => fetchStagedLeads(dataset.id, queryParams),
  });
  const { data: categories } = useQuery({
    queryKey: ['staging-categories', dataset.id],
    queryFn: () => fetchStagingCategories(dataset.id),
  });

  const rows = data?.data ?? [];
  const pagination = data?.pagination;
  const selectionCount = selectAllFiltered ? (pagination?.total ?? 0) : selected.size;

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectAllFiltered(false);
  }, []);

  const resetPageAnd = (fn: () => void) => {
    fn();
    setPage(1);
    clearSelection();
  };

  const selectionBody = () =>
    selectAllFiltered ? { filter } : { ids: Array.from(selected) };

  const categoryMutation = useMutation({
    mutationFn: () => bulkSetStagedCategory(dataset.id, { ...selectionBody(), category: newCategory.trim() }),
    onSuccess: (res) => {
      toast.success(`Updated category for ${res.updated.toLocaleString()} leads`);
      setCategoryDialogOpen(false);
      setNewCategory('');
      clearSelection();
      onChanged();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const previewQuery = useQuery<TransferPreview>({
    queryKey: ['transfer-preview', dataset.id, selectAllFiltered, Array.from(selected).join(','), filter],
    queryFn: () => transferStagedLeads(dataset.id, { ...selectionBody(), dryRun: true }),
    enabled: importDialogOpen && selectionCount > 0,
  });

  const importMutation = useMutation({
    mutationFn: () => transferStagedLeads(dataset.id, { ...selectionBody(), mergeStrategy }),
    onSuccess: () => {
      toast.success('Import started — leads are being added in the background.');
      setImportDialogOpen(false);
      clearSelection();
      onChanged();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleExport = async (format: 'csv' | 'xlsx') => {
    try {
      setExporting(true);
      const url = await getStagingExportUrl(dataset.id, format, filter);
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const togglePageSelection = () => {
    setSelectAllFiltered(false);
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = rows.every((r) => next.has(r.id));
      if (allSelected) rows.forEach((r) => next.delete(r.id));
      else rows.forEach((r) => next.add(r.id));
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatTile label="Total Rows" value={dataset.totalRows} />
        <StatTile label="Unique" value={dataset.uniqueCount} color="green" />
        <StatTile label="Duplicates" value={dataset.duplicateCount} color="blue" />
        <StatTile label="Review" value={dataset.reviewCount} color="yellow" />
        <StatTile label="Invalid" value={dataset.invalidCount} color="red" />
        <StatTile label="Categorized" value={dataset.categorizedCount} color="purple" />
        <StatTile label="Imported" value={dataset.importedCount} color="green" />
        <StatTile label="Errors" value={dataset.errorCount} color="red" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, username, email, website…"
            className="pl-8 w-[280px]"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') resetPageAnd(() => setSearch(searchInput.trim()));
            }}
          />
        </div>
        <Select value={categoryFilter || 'ALL'} onValueChange={(v) => resetPageAnd(() => setCategoryFilter(v === 'ALL' ? '' : v))}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {(categories?.data ?? []).map((c) => (
              <SelectItem key={c.category} value={c.category}>
                {c.category} ({c.count.toLocaleString()})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter || 'ALL'} onValueChange={(v) => resetPageAnd(() => setStatusFilter(v === 'ALL' ? '' : v))}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="UNIQUE">Unique</SelectItem>
            <SelectItem value="DUPLICATE">Duplicate</SelectItem>
            <SelectItem value="REVIEW">Needs review</SelectItem>
            <SelectItem value="INVALID">Invalid</SelectItem>
          </SelectContent>
        </Select>
        <Select value={hasEmailFilter || 'ALL'} onValueChange={(v) => resetPageAnd(() => setHasEmailFilter(v === 'ALL' ? '' : v))}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Email" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Email: any</SelectItem>
            <SelectItem value="true">Has email</SelectItem>
            <SelectItem value="false">No email</SelectItem>
          </SelectContent>
        </Select>
        <Select value={hasWebsiteFilter || 'ALL'} onValueChange={(v) => resetPageAnd(() => setHasWebsiteFilter(v === 'ALL' ? '' : v))}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Website" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Website: any</SelectItem>
            <SelectItem value="true">Has website</SelectItem>
            <SelectItem value="false">No website</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport('csv')} disabled={exporting}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('xlsx')} disabled={exporting}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Excel
          </Button>
        </div>
      </div>

      {selectionCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2.5">
          <span className="text-sm font-medium">{selectionCount.toLocaleString()} selected</span>
          {!selectAllFiltered && pagination && pagination.total > selected.size && (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setSelectAllFiltered(true)}>
              Select all {pagination.total.toLocaleString()} matching
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setCategoryDialogOpen(true)}>
              <TagIcon className="mr-1.5 h-3.5 w-3.5" /> Set Category
            </Button>
            <Button size="sm" onClick={() => setImportDialogOpen(true)}>
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> Import to Leads
            </Button>
            <Button variant="ghost" size="sm" onClick={clearSelection}>Clear</Button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={rows.length > 0 && rows.every((r) => selectAllFiltered || selected.has(r.id))}
                  onCheckedChange={togglePageSelection}
                />
              </TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Website</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">No leads match the current filters.</TableCell></TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className="cursor-pointer" onClick={() => setDetailRow(row)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectAllFiltered || selected.has(row.id)}
                      onCheckedChange={() => {
                        setSelectAllFiltered(false);
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        });
                      }}
                    />
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate">{row.username ?? '—'}</TableCell>
                  <TableCell className="max-w-[180px] truncate font-medium">{row.name ?? '—'}</TableCell>
                  <TableCell>
                    {row.assignedCategory ? (
                      <Badge variant="secondary" className="font-normal">
                        {row.assignedCategory}
                        {row.categoryConfidence != null && row.categoryConfidence < 1 && (
                          <span className="ml-1 opacity-60">{Math.round(row.categoryConfidence * 100)}%</span>
                        )}
                      </Badge>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">{row.email ?? '—'}</TableCell>
                  <TableCell>{row.phone ?? '—'}</TableCell>
                  <TableCell className="max-w-[160px] truncate">{row.website ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={STATUS_BADGE[row.status] ?? 'outline'}>{row.status}</Badge>
                      {row.importedLeadId && <Check className="h-3.5 w-3.5 text-green-600" />}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Showing {(pagination.page - 1) * pagination.limit + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(1)}><ChevronsLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="px-2">Page {pagination.page} of {pagination.totalPages}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pagination.totalPages} onClick={() => setPage(pagination.totalPages)}><ChevronsRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* Row detail: cleaned values vs original raw data */}
      <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailRow?.name ?? detailRow?.username ?? 'Lead details'}</DialogTitle>
            <DialogDescription>
              Row {detailRow?.sourceRow} · {detailRow?.status}
              {detailRow?.dedupReason ? ` — ${detailRow.dedupReason}` : ''}
              {detailRow?.importedLeadId ? ' · imported into Leads' : ''}
            </DialogDescription>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                {(['username', 'name', 'category', 'website', 'email', 'phone'] as const).map((f) => (
                  <div key={f}>
                    <span className="text-xs text-muted-foreground">{FIELD_LABELS[f]}</span>
                    <p className="break-words">{detailRow[f] ?? '—'}</p>
                  </div>
                ))}
                <div>
                  <span className="text-xs text-muted-foreground">Assigned Category</span>
                  <p>
                    {detailRow.assignedCategory ?? '—'}
                    {detailRow.categoryReason ? (
                      <span className="block text-xs text-muted-foreground">{detailRow.categoryReason}</span>
                    ) : null}
                  </p>
                </div>
              </div>
              {detailRow.bio && (
                <div>
                  <span className="text-xs text-muted-foreground">Bio</span>
                  <p className="whitespace-pre-wrap">{detailRow.bio}</p>
                </div>
              )}
              <div>
                <span className="text-xs text-muted-foreground">Original uploaded data</span>
                <div className="mt-1 rounded-md border border-border max-h-56 overflow-y-auto">
                  <Table>
                    <TableBody>
                      {Object.entries(detailRow.rawData ?? {}).map(([k, v]) => (
                        <TableRow key={k}>
                          <TableCell className="py-1.5 text-xs font-medium text-muted-foreground w-[40%]">{k}</TableCell>
                          <TableCell className="py-1.5 text-xs break-all">{String(v) || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk set category */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set category</DialogTitle>
            <DialogDescription>
              Assign a category to {selectionCount.toLocaleString()} selected lead(s).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Category</Label>
            <Input
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="e.g. Photography"
              list="staging-category-options"
            />
            <datalist id="staging-category-options">
              {(categories?.data ?? []).map((c) => (
                <option key={c.category} value={c.category} />
              ))}
            </datalist>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => categoryMutation.mutate()} disabled={!newCategory.trim() || categoryMutation.isPending}>
              {categoryMutation.isPending ? 'Updating…' : 'Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import to Leads with dry-run preview */}
      <AlertDialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import into Leads</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {previewQuery.isLoading ? (
                  <span className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Checking for duplicates…</span>
                ) : previewQuery.data ? (
                  <ul className="text-sm space-y-1">
                    <li><strong>{previewQuery.data.importable.toLocaleString()}</strong> leads will be imported</li>
                    <li>{previewQuery.data.existingInLeads?.toLocaleString() ?? 0} already exist in Leads (skipped or updated by email)</li>
                    <li>{previewQuery.data.noEmail.toLocaleString()} have no valid email and will be skipped</li>
                    <li>{previewQuery.data.alreadyImported.toLocaleString()} were already imported earlier</li>
                  </ul>
                ) : (
                  <span className="text-sm">Preparing preview…</span>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">If a lead already exists in Leads</Label>
                  <Select value={mergeStrategy} onValueChange={(v) => setMergeStrategy(v as 'skip' | 'fill_missing')}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">Skip it (keep existing data)</SelectItem>
                      <SelectItem value="fill_missing">Fill its missing fields</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                importMutation.mutate();
              }}
            >
              {importMutation.isPending ? 'Starting…' : 'Import Leads'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    green: 'text-green-600', blue: 'text-blue-600', yellow: 'text-yellow-600',
    red: 'text-red-600', purple: 'text-purple-600',
  };
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className={`text-xl font-bold ${color ? colorMap[color] ?? '' : ''}`}>{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
