'use client';

import { useState, useRef, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Upload, FileSpreadsheet, Check, AlertCircle, Cloud, History,
  ArrowRight, Loader2,
} from 'lucide-react';

import {
  smartImportLeads,
  previewSmartImport,
  type SmartImportResult,
  type SmartImportPreviewResult,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

type Step = 'source' | 'upload' | 'preview' | 'processing' | 'done';

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

export default function ImportPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('source');
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<SmartImportPreviewResult | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [result, setResult] = useState<SmartImportResult | null>(null);

  const previewMutation = useMutation({
    mutationFn: ({ selectedFile, mappingOverrides }: { selectedFile: File; mappingOverrides?: Record<string, string> }) =>
      previewSmartImport(selectedFile, mappingOverrides),
    onSuccess: (res, variables) => {
      setPreview(res);
      if (!variables.mappingOverrides) {
        const initialMappings: Record<string, string> = {};
        for (const m of res.detectedMappings) {
          initialMappings[m.csvColumn] = m.leadField;
        }
        setMappings(initialMappings);
      }
      setStep('preview');
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setStep('upload');
    },
  });

  const importMutation = useMutation({
    mutationFn: (selectedFile: File) => smartImportLeads(selectedFile, { mappings }),
    onSuccess: (res) => {
      setResult(res);
      setStep('done');
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setStep('preview');
    },
  });

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!isSupportedSpreadsheet(selected)) {
      toast.error('Please select a CSV or Excel (.xlsx) file');
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      toast.error('File size must be under 10 MB');
      return;
    }

    setFile(selected);
    setFileName(selected.name);
    setStep('preview');
    previewMutation.mutate({ selectedFile: selected });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [previewMutation]);

  const handleMappingChange = useCallback((csvColumn: string, leadField: string | null) => {
    const updated = { ...mappings };
    if (leadField) {
      updated[csvColumn] = leadField;
    } else {
      delete updated[csvColumn];
    }
    setMappings(updated);
    if (file) {
      previewMutation.mutate({ selectedFile: file, mappingOverrides: updated });
    }
  }, [file, mappings, previewMutation]);

  const handleImport = useCallback(() => {
    if (!file) return;
    setStep('processing');
    importMutation.mutate(file);
  }, [file, importMutation]);

  const stepLabels = ['Upload', 'Preview', 'Import', 'Done'];
  const stepKeys: Step[] = ['upload', 'preview', 'processing', 'done'];

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
                  <CardDescription>Upload a CSV or Excel file — columns are detected automatically</CardDescription>
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
              Select a CSV or Excel file with your lead data. Columns will be detected and mapped automatically.
              Maximum 10,000 rows, 10 MB.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-12 text-center hover:border-primary/50 cursor-pointer transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="text-sm font-medium">Click to select a CSV or Excel file</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Supported formats: .csv, .xlsx, .xls
              </p>
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

      {step === 'preview' && (
        <div className="space-y-4">
          {previewMutation.isPending ? (
            <Card>
              <CardContent className="py-12 flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Analyzing {fileName}...</p>
              </CardContent>
            </Card>
          ) : preview ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Import Preview</CardTitle>
                  <CardDescription>
                    {preview.totalRowCount} rows in <strong>{fileName}</strong> — verify detected fields before importing.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <StatTile label="Total Rows" value={preview.fieldStats.totalRows} />
                    <StatTile label="Valid Rows" value={preview.fieldStats.validRows} />
                    <StatTile label="Email" value={preview.fieldStats.email} />
                    <StatTile label="Phone" value={preview.fieldStats.phone} />
                    <StatTile label="Website" value={preview.fieldStats.website} />
                    <StatTile label="Owner" value={preview.fieldStats.owner} />
                    <StatTile label="Company" value={preview.fieldStats.company} />
                  </div>

                  {preview.detectedMappings.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-2">Detected Fields</p>
                      <div className="space-y-2">
                        {preview.detectedMappings.map((m) => (
                          <div key={m.csvColumn} className="flex items-center gap-2 text-sm">
                            <Check className="h-4 w-4 text-green-600 shrink-0" />
                            <span>{FIELD_LABELS[m.leadField] ?? m.leadField}</span>
                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            <span className="text-muted-foreground">&quot;{m.csvColumn}&quot;</span>
                            <Badge variant="outline" className="text-xs ml-auto">
                              {Math.round(m.confidence * 100)}%
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-sm font-medium mb-2">Column Mapping</p>
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
                                  onValueChange={(v) => {
                                    handleMappingChange(header, v === '__skip__' ? null : v);
                                  }}
                                >
                                  <SelectTrigger className="w-[200px]">
                                    <SelectValue placeholder="Skip" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__skip__">Skip</SelectItem>
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
                    <Button variant="outline" onClick={() => { setStep('upload'); setPreview(null); setFile(null); }}>
                      Choose Different File
                    </Button>
                    <Button onClick={handleImport} disabled={!file || Object.keys(mappings).length === 0}>
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      Import {preview.fieldStats.validRows} Leads
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      )}

      {step === 'processing' && (
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Processing Import
            </CardTitle>
            <CardDescription>
              Normalizing, deduplicating, and importing leads from <strong>{fileName}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={undefined} className="h-2" />
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p>Normalizing names, phones, emails, websites...</p>
              <p>Checking for duplicates...</p>
              <p>Importing leads...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'done' && result && (
        <div className="space-y-4">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-green-600" />
                Import Complete
              </CardTitle>
              <CardDescription>
                Processed {result.summary.totalRows} rows from <strong>{fileName}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatTile label="Created" value={result.summary.created} color="green" />
                <StatTile label="Updated" value={result.summary.updated} color="blue" />
                <StatTile label="Skipped" value={result.summary.skipped} color="yellow" />
                <StatTile label="Errors" value={result.summary.errors} color="red" />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {result.summary.emailDetected != null && (
                  <StatTile label="Emails Detected" value={result.summary.emailDetected} />
                )}
                {result.summary.phoneDetected != null && (
                  <StatTile label="Phones Detected" value={result.summary.phoneDetected} />
                )}
                {result.summary.websiteDetected != null && (
                  <StatTile label="Websites Detected" value={result.summary.websiteDetected} />
                )}
                {result.summary.noEmail > 0 && (
                  <StatTile label="Skipped — No Email" value={result.summary.noEmail} color="gray" />
                )}
                {result.summary.invalidEmail > 0 && (
                  <StatTile label="Skipped — Invalid Email" value={result.summary.invalidEmail} color="gray" />
                )}
                {result.summary.qualificationQueued > 0 && (
                  <StatTile label="Enrichment Queued" value={result.summary.qualificationQueued} color="purple" />
                )}
              </div>

              {result.mappings.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Detected Column Mappings</p>
                  <div className="flex flex-wrap gap-2">
                    {result.mappings.map((m) => (
                      <Badge key={m.csvColumn} variant="secondary" className="text-xs">
                        {m.csvColumn} <ArrowRight className="inline h-3 w-3 mx-1" /> {FIELD_LABELS[m.leadField] ?? m.leadField}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {result.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    Import Errors ({result.errors.length})
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-border p-3 space-y-1">
                    {result.errors.map((err, i) => (
                      <p key={i} className="text-xs text-destructive">
                        Row {err.row}: {err.message}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setStep('source'); setResult(null); setPreview(null); setFile(null); }}>
                  Import Another File
                </Button>
                <Button onClick={() => router.push('/leads')}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  View Imported Leads
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
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
