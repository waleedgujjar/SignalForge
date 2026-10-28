'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Upload, FileSpreadsheet, Check, AlertCircle, Cloud, History, Loader2,
} from 'lucide-react';

import {
  previewSmartImport,
  startSmartImport,
  fetchSmartImportProgress,
  type SmartImportPreviewResult,
  type ImportProgress,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { isSupportedSpreadsheet } from '@/lib/spreadsheet-parser';

type Step = 'source' | 'upload' | 'review' | 'processing' | 'done';
type MergeStrategy = 'skip' | 'fill_missing';

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

const FIELD_LABELS: Record<string, string> = {
  email: 'Email', firstName: 'First Name', lastName: 'Last Name', fullName: 'Owner Name',
  company: 'Company', companyDomain: 'Company Domain', jobTitle: 'Job Title', industry: 'Industry',
  phone: 'Phone', linkedinUrl: 'LinkedIn URL', linkedinCompanyUrl: 'LinkedIn Company URL',
  countryCode: 'Country Code', country: 'Country', region: 'Region', state: 'State', city: 'City',
  website: 'Website', socialAccount: 'Social Account', googleUrl: 'Google Maps URL',
  rating: 'Rating', service: 'Service', aiChatbot: 'AI Chatbot', websiteType: 'Website Type',
};

const MAPPABLE_FIELDS = [
  'email', 'firstName', 'lastName', 'fullName', 'company', 'companyDomain',
  'jobTitle', 'industry', 'phone', 'linkedinUrl', 'linkedinCompanyUrl',
  'countryCode', 'country', 'region', 'state', 'city', 'website',
];

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export default function ImportPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('source');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<SmartImportPreviewResult | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>('skip');
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const previewMutation = useMutation({
    mutationFn: (selectedFile: File) => previewSmartImport(selectedFile),
    onSuccess: (res) => {
      setPreview(res);
      const initial: Record<string, string> = {};
      for (const m of res.detectedMappings) initial[m.csvColumn] = m.leadField;
      setMappings(initial);
      setStep('review');
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setStep('upload');
    },
  });

  const startMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('Nothing to import');
      return startSmartImport(preview.importId, { mappings, mergeStrategy });
    },
    onSuccess: () => setStep('processing'),
    onError: (err: Error) => toast.error(err.message),
  });

  // Poll import progress while processing.
  useEffect(() => {
    if (step !== 'processing' || !preview?.importId) return;
    let active = true;
    const importId = preview.importId;
    const tick = async () => {
      try {
        const p = await fetchSmartImportProgress(importId);
        if (!active) return;
        setProgress(p);
        if (TERMINAL.has(p.status)) {
          setStep('done');
          queryClient.invalidateQueries({ queryKey: ['leads'] });
          return;
        }
      } catch {
        // transient; keep polling
      }
      if (active) window.setTimeout(tick, 2000);
    };
    void tick();
    return () => { active = false; };
  }, [step, preview?.importId, queryClient]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!isSupportedSpreadsheet(selected)) {
      toast.error('Please select a CSV or Excel (.xlsx) file');
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      toast.error('File size must be under 150 MB');
      return;
    }
    setFileName(selected.name);
    setStep('review');
    previewMutation.mutate(selected);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [previewMutation]);

  const handleMappingChange = useCallback((csvColumn: string, leadField: string | null) => {
    setMappings((prev) => {
      const updated = { ...prev };
      if (leadField) updated[csvColumn] = leadField;
      else delete updated[csvColumn];
      return updated;
    });
  }, []);

  const resetAll = () => {
    setStep('source'); setPreview(null); setMappings({}); setProgress(null); setFileName('');
  };

  const stepLabels = ['Upload', 'Review', 'Import', 'Done'];
  const stepKeys: Step[] = ['upload', 'review', 'processing', 'done'];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/leads')}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Leads
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-xl font-semibold">Import Leads</h1>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/leads/import/history">
            <History className="mr-1.5 h-3.5 w-3.5" />
            Import History
          </Link>
        </Button>
      </div>

      {step !== 'source' && (
        <div className="flex items-center gap-2 text-sm">
          {stepLabels.map((label, i) => {
            const currentIdx = stepKeys.indexOf(step);
            return (
              <div key={label} className="flex items-center gap-2">
                <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  i <= currentIdx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}>
                  {i < currentIdx ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <span className={i <= currentIdx ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
                {i < stepLabels.length - 1 && <Separator className="w-8" />}
              </div>
            );
          })}
        </div>
      )}

      {step === 'source' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Choose how you want to import leads.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Card
              className="cursor-pointer border-2 border-transparent transition-colors hover:border-primary/50"
              onClick={() => setStep('upload')}
            >
              <CardHeader className="flex flex-row items-center gap-4 space-y-0 pb-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <Upload className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Upload File</CardTitle>
                  <CardDescription>Upload a CSV or Excel file — large files import in the background</CardDescription>
                </div>
              </CardHeader>
            </Card>
            <Card
              className="cursor-pointer border-2 border-transparent transition-colors hover:border-primary/50"
              onClick={() => router.push('/leads/import/drive')}
            >
              <CardHeader className="flex flex-row items-center gap-4 space-y-0 pb-2">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10">
                  <Cloud className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <CardTitle className="text-base">Google Drive</CardTitle>
                  <CardDescription>Import CSV/XLSX files from Google Drive</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </div>
        </div>
      )}

      {step === 'upload' && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Upload File</CardTitle>
            <CardDescription>
              Select a CSV or Excel file. Columns are detected automatically; large files (up to 150 MB)
              are cleaned and imported in the background.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-12 text-center hover:border-primary/50 cursor-pointer transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="text-sm font-medium">Click to select a CSV or Excel file</p>
              <p className="mt-1 text-xs text-muted-foreground">Supported: .csv, .xlsx, .xls — up to 150 MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={handleFileSelect}
            />
          </CardContent>
        </Card>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          {previewMutation.isPending ? (
            <Card>
              <CardContent className="py-12 flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Uploading and analyzing {fileName}…</p>
              </CardContent>
            </Card>
          ) : preview ? (
            <Card>
              <CardHeader>
                <CardTitle>Review &amp; Clean</CardTitle>
                <CardDescription>
                  Previewing the first {preview.sampleSize} rows of <strong>{fileName}</strong>. Align columns and
                  choose how duplicates are handled, then import the whole file.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatTile label="Sample Rows" value={preview.sampleSize} />
                  <StatTile label="Valid (sample)" value={preview.fieldStats.validRows} color="green" />
                  <StatTile label="No Email (sample)" value={preview.noEmail} color="gray" />
                  <StatTile label="Invalid Email (sample)" value={preview.invalidEmail} color="gray" />
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Duplicate handling</p>
                  <Select value={mergeStrategy} onValueChange={(v) => setMergeStrategy(v as MergeStrategy)}>
                    <SelectTrigger className="w-[320px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">Skip leads that already exist</SelectItem>
                      <SelectItem value="fill_missing">Update existing leads (fill missing fields)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Rows without a valid email are always skipped. Duplicates are matched by email.
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Column mapping</p>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>File Column</TableHead>
                          <TableHead>Map To</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.headers.map((header) => (
                          <TableRow key={header}>
                            <TableCell className="font-medium">{header}</TableCell>
                            <TableCell>
                              <Select
                                value={mappings[header] ?? '__skip__'}
                                onValueChange={(v) => handleMappingChange(header, v === '__skip__' ? null : v)}
                              >
                                <SelectTrigger className="w-[220px]">
                                  <SelectValue placeholder="Skip" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__skip__">Skip this column</SelectItem>
                                  {MAPPABLE_FIELDS.map((f) => (
                                    <SelectItem key={f} value={f}>{FIELD_LABELS[f] ?? f}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {preview.previewRows.length > 0 && (
                  <div>
                    <p className="text-sm font-medium mb-2">Preview (first {preview.previewRows.length} rows)</p>
                    <div className="rounded-lg border border-border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Company</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>Website</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.previewRows.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell>{row.name ?? '—'}</TableCell>
                              <TableCell>{row.company ?? '—'}</TableCell>
                              <TableCell>{row.email ?? '—'}</TableCell>
                              <TableCell>{row.phone ?? '—'}</TableCell>
                              <TableCell className="max-w-[160px] truncate">{row.website ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={resetAll}>Choose Different File</Button>
                  <Button
                    onClick={() => startMutation.mutate()}
                    disabled={startMutation.isPending || Object.keys(mappings).length === 0}
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Start Import
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {step === 'processing' && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Importing {fileName}
            </CardTitle>
            <CardDescription>
              Your file is being cleaned and imported in the background. You can keep this page open to watch progress.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={undefined} className="h-2" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Imported" value={progress?.importedCount ?? 0} color="green" />
              <StatTile label="Duplicates" value={progress?.duplicateCount ?? 0} color="blue" />
              <StatTile label="Skipped" value={progress?.skippedCount ?? 0} color="yellow" />
              <StatTile label="Errors" value={progress?.errorCount ?? 0} color="red" />
            </div>
            <p className="text-xs text-muted-foreground">Status: {progress?.status ?? 'starting…'}</p>
          </CardContent>
        </Card>
      )}

      {step === 'done' && progress && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {progress.status === 'FAILED' ? (
                <><AlertCircle className="h-5 w-5 text-destructive" /> Import Failed</>
              ) : (
                <><Check className="h-5 w-5 text-green-600" /> Import Complete</>
              )}
            </CardTitle>
            <CardDescription>
              {progress.status === 'FAILED'
                ? `The import of ${fileName} did not finish. No partial data was left in an inconsistent state.`
                : `Finished importing ${fileName}${progress.totalRows ? ` — ${progress.totalRows} rows processed` : ''}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatTile label="Imported" value={progress.importedCount ?? 0} color="green" />
              <StatTile label="Duplicates" value={progress.duplicateCount ?? 0} color="blue" />
              <StatTile label="Skipped" value={progress.skippedCount ?? 0} color="yellow" />
              <StatTile label="Errors" value={progress.errorCount ?? 0} color="red" />
            </div>
            <p className="text-xs text-muted-foreground">
              Skipped includes rows with a missing or invalid email. Duplicates are existing leads matched by email.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetAll}>Import Another File</Button>
              <Button onClick={() => router.push('/leads')}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                View Imported Leads
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    green: 'text-green-600', blue: 'text-blue-600', yellow: 'text-yellow-600',
    red: 'text-red-600', gray: 'text-muted-foreground', purple: 'text-purple-600',
  };
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <p className={`text-2xl font-bold ${color ? colorMap[color] ?? 'text-foreground' : 'text-foreground'}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
