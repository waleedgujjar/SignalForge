'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import {
  Radar, Search, Upload, History, Loader2, ChevronDown, FileSpreadsheet, Info,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  createDiscoveryJob,
  fetchDiscoverySources,
  previewDiscoveryImport,
  type DiscoverySearchInput,
} from '@/lib/api';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function resolveImportMimeType(mimeType: string, filename: string): string {
  const ext = filename.toLowerCase();
  const normalized = mimeType.trim().toLowerCase();
  if (ext.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (
    ext.endsWith('.csv') ||
    normalized === 'text/csv' ||
    normalized === 'application/csv' ||
    normalized === 'text/plain' ||
    normalized === 'application/vnd.ms-excel'
  ) {
    return 'text/csv';
  }
  return mimeType || 'text/csv';
}

const DEFAULT_QUERY: DiscoverySearchInput = {
  maxResults: 50,
  requireWebsite: false,
  requirePhone: false,
  requireEmail: false,
  minScore: 0,
};

/// Read a File as base64 without pulling the whole thing through a data URL.
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export default function DiscoverPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState('CSV');
  const [query, setQuery] = useState<DiscoverySearchInput>(DEFAULT_QUERY);
  const [keywords, setKeywords] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [mappings, setMappings] = useState<Record<string, string> | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; rows: Record<string, string>[]; totalRowCount: number } | null>(null);

  const { data: sourcesData, isLoading: sourcesLoading } = useQuery({
    queryKey: ['discovery-sources'],
    queryFn: fetchDiscoverySources,
  });

  const sources = sourcesData?.data ?? [];
  const selectedSource = useMemo(() => sources.find((s) => s.source === source), [sources, source]);
  const isFileSource = selectedSource?.fileBased ?? false;

  const previewMutation = useMutation({
    mutationFn: previewDiscoveryImport,
    onSuccess: (result) => {
      setPreview({ headers: result.headers, rows: result.rows, totalRowCount: result.totalRowCount });
      setMappings(result.mappings);
      setQuery((prev) => ({
        ...prev,
        maxResults: Math.min(Math.max(result.totalRowCount, 1), 500),
        requireWebsite: false,
        requirePhone: false,
        requireEmail: false,
        minScore: 0,
      }));
      const mapped = Object.keys(result.mappings).length;
      if (mapped === 0) {
        toast.warning('No columns were recognised — map them manually before importing.');
      } else {
        toast.success(`Detected ${mapped} column${mapped === 1 ? '' : 's'} from ${result.totalRowCount} rows`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: createDiscoveryJob,
    onSuccess: (result) => {
      toast.success('Discovery started');
      router.push(`/leads/discovery/${result.jobId}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;

    if (selected.size > MAX_UPLOAD_BYTES) {
      toast.error('File is larger than 8MB. Split it into smaller files and import them separately.');
      event.target.value = '';
      return;
    }

    setFile(selected);
    setPreview(null);
    setMappings(null);

    const base64 = await readFileAsBase64(selected);
    const mimeType = resolveImportMimeType(selected.type || '', selected.name);
    if (selected.name.endsWith('.xlsx')) {
      setSource('XLSX');
    } else {
      setSource('CSV');
    }

    previewMutation.mutate({
      data: base64,
      mimeType,
      filename: selected.name,
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (isFileSource && !file) {
      toast.error('Choose a CSV or XLSX file first');
      return;
    }

    const payload = {
      source,
      query: {
        ...query,
        keywords: keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      },
      ...(file
        ? {
            file: {
              data: await readFileAsBase64(file),
              mimeType: resolveImportMimeType(file.type || '', file.name),
              filename: file.name,
              columnMappings: mappings ?? undefined,
            },
          }
        : {}),
    };

    createMutation.mutate(payload);
  }

  function update<K extends keyof DiscoverySearchInput>(key: K, value: DiscoverySearchInput[K]) {
    setQuery((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discover leads"
        description="Search a source or import a file, then normalize, deduplicate and qualify in one pass."
        variant="hero"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('/leads/discovery/history')}>
              <History className="mr-2 h-4 w-4" />
              History
            </Button>
          </div>
        }
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-border p-6">
          <div className="mb-4 flex items-center gap-2">
            <Radar className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Source</h2>
          </div>

          {sourcesLoading ? (
            <Skeleton className="h-10 w-full max-w-sm" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="source">Discovery source</Label>
                <Select
                  value={source}
                  onValueChange={(value) => {
                    setSource(value);
                    setFile(null);
                    setPreview(null);
                    setMappings(null);
                  }}
                >
                  <SelectTrigger id="source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((entry) => (
                      <SelectItem key={entry.source} value={entry.source} disabled={!entry.implemented}>
                        {entry.displayName}
                        {!entry.implemented ? ' — not configured' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedSource?.billable ? (
                  <p className="flex items-start gap-1.5 text-xs text-amber-600">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    This provider may bill your account per search.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Free — no external API cost.</p>
                )}
              </div>

              {isFileSource && (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="file">CSV or XLSX file</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="file"
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={handleFileChange}
                    />
                    {previewMutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>
                  {file && <p className="text-xs text-muted-foreground">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
                </div>
              )}
            </div>
          )}
        </Card>

        {preview && mappings && (
          <Card className="border-border p-6">
            <div className="mb-4 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Column mapping</h2>
              <Badge variant="secondary">{preview.totalRowCount} rows</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {preview.headers.map((header) => (
                <div key={header} className="space-y-1.5">
                  <Label className="text-xs">{header}</Label>
                  <Select
                    value={mappings[header] ?? 'SKIP'}
                    onValueChange={(value) =>
                      setMappings((prev) => {
                        const next = { ...(prev ?? {}) };
                        if (value === 'SKIP') delete next[header];
                        else next[header] = value;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SKIP">Skip this column</SelectItem>
                      {[
                        'company', 'companyDomain', 'website', 'email', 'firstName', 'lastName',
                        'fullName', 'jobTitle', 'phone', 'industry', 'country', 'countryCode',
                        'state', 'city', 'postalCode',
                      ].map((field) => (
                        <SelectItem key={field} value={field}>{field}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </Card>
        )}

        {!isFileSource && (
          <Card className="border-border p-6">
            <div className="mb-4 flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Search criteria</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input id="country" placeholder="United States" value={query.country ?? ''} onChange={(e) => update('country', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State / province</Label>
                <Input id="state" placeholder="Texas" value={query.state ?? ''} onChange={(e) => update('state', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input id="city" placeholder="Austin" value={query.city ?? ''} onChange={(e) => update('city', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="industry">Industry</Label>
                <Input id="industry" placeholder="Dental" value={query.industry ?? ''} onChange={(e) => update('industry', e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="keywords">Keywords</Label>
                <Input id="keywords" placeholder="Dental Clinic, Dentist" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
                <p className="text-xs text-muted-foreground">Comma separated.</p>
              </div>
            </div>
          </Card>
        )}

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <Card className="border-border">
            <CollapsibleTrigger asChild>
              <button type="button" className="flex w-full items-center justify-between p-6 text-left">
                <span className="text-sm font-semibold">Filters &amp; limits</span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid gap-4 border-t border-border p-6 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="maxResults">Maximum leads</Label>
                  <Input
                    id="maxResults"
                    type="number"
                    min={1}
                    max={500}
                    value={query.maxResults}
                    onChange={(e) => update('maxResults', Number(e.target.value) || 1)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="minScore">Minimum score</Label>
                  <Input
                    id="minScore"
                    type="number"
                    min={0}
                    max={100}
                    value={query.minScore}
                    onChange={(e) => update('minScore', Number(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-3 sm:col-span-2">
                  <Label>Require</Label>
                  <div className="flex flex-wrap gap-4">
                    {([
                      ['requireWebsite', 'Website'],
                      ['requirePhone', 'Phone'],
                      ['requireEmail', 'Email'],
                    ] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={query[key]}
                          onCheckedChange={(checked) => update(key, checked === true)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : isFileSource ? (
              <Upload className="mr-2 h-4 w-4" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            {isFileSource ? 'Import leads' : 'Discover leads'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Runs in the background — you can leave this page.
          </p>
        </div>
      </form>
    </div>
  );
}
