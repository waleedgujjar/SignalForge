'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Folder, FileSpreadsheet, Check, AlertCircle,
  ChevronRight, Loader2, AlertTriangle, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  fetchIntegrations,
  fetchDriveFolders,
  fetchDriveFiles,
  fetchDriveFilePreview,
  startDriveImport,
  fetchImportProgress,
  fetchTags,
  fetchLists,
} from '@/lib/api';
import type {
  Integration, CloudFolder, CloudFile, FilePreview,
  ImportProgress,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const LEAD_FIELDS = [
  { value: 'email', label: 'Email' },
  { value: 'firstName', label: 'First Name' },
  { value: 'lastName', label: 'Last Name' },
  { value: 'fullName', label: 'Full Name' },
  { value: 'company', label: 'Company' },
  { value: 'companyDomain', label: 'Company Domain' },
  { value: 'jobTitle', label: 'Job Title' },
  { value: 'industry', label: 'Industry' },
  { value: 'phone', label: 'Phone' },
  { value: 'linkedinUrl', label: 'LinkedIn Person URL' },
  { value: 'linkedinCompanyUrl', label: 'LinkedIn Company URL' },
  { value: 'countryCode', label: 'Country Code' },
  { value: 'country', label: 'Country' },
  { value: 'region', label: 'Region' },
  { value: 'state', label: 'State' },
  { value: 'city', label: 'City' },
  { value: 'website', label: 'Website' },
];

type Step = 'connect' | 'browse' | 'preview' | 'options' | 'importing' | 'done';

interface SelectedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DriveImportPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('connect');
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>();
  const [folderPath, setFolderPath] = useState<{ id?: string; name: string }[]>([
    { name: 'My Drive' },
  ]);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [importId, setImportId] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportProgress | null>(null);

  const { data: integrations = [], isLoading: loadingIntegrations } = useQuery({
    queryKey: ['integrations'],
    queryFn: fetchIntegrations,
  });

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: fetchTags,
  });

  const { data: lists = [] } = useQuery({
    queryKey: ['lists'],
    queryFn: fetchLists,
  });

  useEffect(() => {
    const connected = integrations.find(
      (i) => i.provider === 'GOOGLE_DRIVE' && i.status === 'CONNECTED',
    );
    if (connected) {
      setIntegration(connected);
      if (step === 'connect') setStep('browse');
    }
  }, [integrations, step]);

  const { data: folders = [], isLoading: loadingFolders } = useQuery({
    queryKey: ['drive-folders', integration?.id, currentFolderId],
    queryFn: () => fetchDriveFolders(integration!.id, currentFolderId),
    enabled: !!integration && step === 'browse',
  });

  const { data: files = [], isLoading: loadingFiles } = useQuery({
    queryKey: ['drive-files', integration?.id, currentFolderId ?? 'root'],
    queryFn: () => fetchDriveFiles(integration!.id, currentFolderId ?? 'root'),
    enabled: !!integration && step === 'browse',
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!integration || selectedFiles.length === 0) throw new Error('No files selected');
      return fetchDriveFilePreview(integration.id, selectedFiles[0]!.id);
    },
    onSuccess: (data) => {
      setPreview(data);
      const autoMappings: Record<string, string> = {};
      for (const m of data.suggestedMappings) {
        if (m.leadField) autoMappings[m.csvColumn] = m.leadField;
      }
      setMappings(autoMappings);
      setStep('preview');
    },
    onError: (err: Error) => {
      toast.error(`Preview failed: ${err.message}`);
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!integration) throw new Error('Not connected');
      return startDriveImport({
        integrationId: integration.id,
        files: selectedFiles.map((f) => ({
          fileId: f.id,
          fileName: f.name,
          mimeType: f.mimeType,
          size: f.size,
        })),
        mappings,
        options: {
          skipDuplicates,
          tagIds: selectedTagIds.length > 0 ? selectedTagIds : undefined,
          listId: selectedListId || undefined,
        },
      });
    },
    onSuccess: (data) => {
      setImportId(data.importId);
      setStep('importing');
    },
    onError: (err: Error) => {
      toast.error(`Import failed: ${err.message}`);
    },
  });

  // Poll for progress
  useEffect(() => {
    if (step !== 'importing' || !importId) return;
    const interval = setInterval(async () => {
      try {
        const progress = await fetchImportProgress(importId);
        if (progress.status === 'COMPLETED' || progress.status === 'FAILED') {
          setImportResult(progress);
          setStep('done');
          queryClient.invalidateQueries({ queryKey: ['leads'] });
          clearInterval(interval);
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [step, importId, queryClient]);

  const navigateFolder = useCallback((folder: CloudFolder) => {
    setCurrentFolderId(folder.id);
    setFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }]);
  }, []);

  const navigateBreadcrumb = useCallback((index: number) => {
    const target = folderPath[index];
    setCurrentFolderId(target?.id);
    setFolderPath((prev) => prev.slice(0, index + 1));
  }, [folderPath]);

  const toggleFile = useCallback((file: CloudFile) => {
    setSelectedFiles((prev) => {
      const exists = prev.find((f) => f.id === file.id);
      if (exists) return prev.filter((f) => f.id !== file.id);
      return [...prev, { id: file.id, name: file.name, mimeType: file.mimeType, size: file.size }];
    });
  }, []);

  const emailMapped = Object.values(mappings).includes('email');

  const stepLabels = ['Browse', 'Map Columns', 'Options', 'Import'];
  const stepKeys: Step[] = ['browse', 'preview', 'options', 'done'];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/leads/import')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Import
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <h1 className="text-xl font-semibold">Import from Google Drive</h1>
      </div>

      {step !== 'connect' && (
        <div className="flex items-center gap-2 text-sm">
          {stepLabels.map((label, i) => {
            const currentIdx = stepKeys.indexOf(step);
            const isImporting = step === 'importing';
            const idx = isImporting ? 2.5 : currentIdx;
            return (
              <div key={label} className="flex items-center gap-2">
                <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  i <= idx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}>
                  {i < idx ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                <span className={i <= idx ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
                {i < stepLabels.length - 1 && <Separator className="w-8" />}
              </div>
            );
          })}
        </div>
      )}

      {/* Step: Connect */}
      {step === 'connect' && (
        <Card>
          <CardHeader>
            <CardTitle>Connect Google Drive</CardTitle>
            <CardDescription>
              You need to connect your Google Drive account before importing files.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingIntegrations ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking connection...
              </div>
            ) : (
              <Button asChild>
                <a href="/settings/integrations">Connect Google Drive</a>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step: Browse & Select */}
      {step === 'browse' && integration && (
        <Card>
          <CardHeader>
            <CardTitle>Select Files</CardTitle>
            <CardDescription>
              Connected as <strong>{integration.accountEmail}</strong>. Browse and select CSV or XLSX files to import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Breadcrumb path */}
            <div className="flex items-center gap-1 text-sm">
              {folderPath.map((crumb, i) => (
                <div key={i} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                  <button
                    className="text-primary hover:underline"
                    onClick={() => navigateBreadcrumb(i)}
                  >
                    {crumb.name}
                  </button>
                </div>
              ))}
            </div>

            {/* Folder + file list */}
            <div className="rounded-lg border border-border">
              {(loadingFolders || loadingFiles) ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50 transition-colors"
                      onClick={() => navigateFolder(folder)}
                    >
                      <Folder className="h-4 w-4 text-blue-500 shrink-0" />
                      <span className="flex-1 truncate">{folder.name}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                  {files.map((file) => {
                    const isSelected = selectedFiles.some((f) => f.id === file.id);
                    return (
                      <button
                        key={file.id}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/50 transition-colors ${
                          isSelected ? 'bg-primary/5' : ''
                        }`}
                        onClick={() => toggleFile(file)}
                      >
                        <Checkbox checked={isSelected} className="pointer-events-none" />
                        <FileSpreadsheet className="h-4 w-4 text-green-600 shrink-0" />
                        <span className="flex-1 truncate">{file.name}</span>
                        <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                      </button>
                    );
                  })}
                  {folders.length === 0 && files.length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No importable files in this folder.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Selected files summary */}
            {selectedFiles.length > 0 && (
              <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3">
                <span className="text-sm font-medium">
                  {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedFiles([])}>
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    disabled={previewMutation.isPending}
                    onClick={() => previewMutation.mutate()}
                  >
                    {previewMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                    Continue
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step: Preview & Map Columns */}
      {step === 'preview' && preview && (
        <Card>
          <CardHeader>
            <CardTitle>Map Columns</CardTitle>
            <CardDescription>
              {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected.
              {preview.previouslyImported && (
                <span className="ml-2 inline-flex items-center gap-1 text-yellow-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  This file was previously imported
                  {preview.lastImportedAt && ` on ${new Date(preview.lastImportedAt).toLocaleDateString()}`}.
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Column</TableHead>
                  <TableHead>Sample Data</TableHead>
                  <TableHead>Map To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.headers.map((h) => (
                  <TableRow key={h}>
                    <TableCell className="font-medium">{h}</TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                      {preview.rows[0]?.[h] ?? ''}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={mappings[h] || 'SKIP'}
                        onValueChange={(v) => setMappings({ ...mappings, [h]: v === 'SKIP' ? '' : v })}
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SKIP">Skip</SelectItem>
                          {LEAD_FIELDS.map((f) => (
                            <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {!emailMapped && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                Email column must be mapped to proceed.
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('browse')}>Back</Button>
              <Button disabled={!emailMapped} onClick={() => setStep('options')}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Import Options */}
      {step === 'options' && (
        <Card>
          <CardHeader>
            <CardTitle>Import Options</CardTitle>
            <CardDescription>
              Configure how leads should be imported.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="skip-dupes"
                  checked={skipDuplicates}
                  onCheckedChange={(v) => setSkipDuplicates(v === true)}
                />
                <Label htmlFor="skip-dupes">Skip duplicate emails (already in workspace)</Label>
              </div>

              {tags.length > 0 && (
                <div className="space-y-2">
                  <Label>Apply Tags</Label>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => {
                      const selected = selectedTagIds.includes(tag.id);
                      return (
                        <Badge
                          key={tag.id}
                          variant={selected ? 'default' : 'outline'}
                          className="cursor-pointer"
                          onClick={() =>
                            setSelectedTagIds((prev) =>
                              selected ? prev.filter((id) => id !== tag.id) : [...prev, tag.id],
                            )
                          }
                        >
                          {tag.name}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              {lists.length > 0 && (
                <div className="space-y-2">
                  <Label>Add to List</Label>
                  <Select value={selectedListId} onValueChange={setSelectedListId}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="No list" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No list</SelectItem>
                      {lists.map((list) => (
                        <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <h3 className="text-sm font-medium">Summary</h3>
              <div className="rounded-lg bg-muted/50 p-4 text-sm space-y-1">
                <p><strong>Files:</strong> {selectedFiles.map((f) => f.name).join(', ')}</p>
                <p><strong>Fields mapped:</strong> {Object.values(mappings).filter(Boolean).length}</p>
                <p><strong>Skip duplicates:</strong> {skipDuplicates ? 'Yes' : 'No'}</p>
                {selectedTagIds.length > 0 && (
                  <p><strong>Tags:</strong> {tags.filter((t) => selectedTagIds.includes(t.id)).map((t) => t.name).join(', ')}</p>
                )}
                {selectedListId && selectedListId !== 'none' && (
                  <p><strong>List:</strong> {lists.find((l) => l.id === selectedListId)?.name}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('preview')}>Back</Button>
              <Button
                disabled={importMutation.isPending}
                onClick={() => importMutation.mutate()}
              >
                {importMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Start Import
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Importing */}
      {step === 'importing' && (
        <Card>
          <CardHeader>
            <CardTitle>Importing...</CardTitle>
            <CardDescription>Your leads are being imported from Google Drive.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={undefined} className="h-2" />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing files... This may take a moment.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Done */}
      {step === 'done' && importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {importResult.status === 'COMPLETED' ? (
                <><Check className="h-5 w-5 text-green-600" /> Import Complete</>
              ) : (
                <><AlertCircle className="h-5 w-5 text-red-600" /> Import Failed</>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="rounded-lg border border-border p-4 text-center">
                <p className="text-2xl font-bold">{importResult.totalRows ?? 0}</p>
                <p className="text-sm text-muted-foreground">Total Rows</p>
              </div>
              <div className="rounded-lg border border-border p-4 text-center">
                <p className="text-2xl font-bold text-green-600">{importResult.importedCount ?? 0}</p>
                <p className="text-sm text-muted-foreground">Imported</p>
              </div>
              <div className="rounded-lg border border-border p-4 text-center">
                <p className="text-2xl font-bold text-yellow-600">{importResult.skippedCount ?? 0}</p>
                <p className="text-sm text-muted-foreground">Skipped</p>
              </div>
              <div className="rounded-lg border border-border p-4 text-center">
                <p className="text-2xl font-bold text-red-600">{importResult.errorCount ?? 0}</p>
                <p className="text-sm text-muted-foreground">Errors</p>
              </div>
            </div>

            {importResult.files.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Per-file Results</h3>
                <div className="rounded-lg border border-border divide-y divide-border">
                  {importResult.files.map((file) => (
                    <div key={file.sourceFileName} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-green-600" />
                        <span>{file.sourceFileName}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{file.importedRowCount ?? 0} imported</span>
                        <span>{file.skippedRowCount ?? 0} skipped</span>
                        <span>{file.errorRowCount ?? 0} errors</span>
                        <Badge variant={file.status === 'COMPLETED' ? 'default' : 'destructive'} className="text-xs">
                          {file.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setStep('browse');
                setSelectedFiles([]);
                setPreview(null);
                setMappings({});
                setImportId(null);
                setImportResult(null);
              }}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Import More
              </Button>
              <Button onClick={() => router.push('/leads')}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                View Leads
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
