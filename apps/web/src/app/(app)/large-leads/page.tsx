'use client';

import { useRef, useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Database, Loader2, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import {
  uploadStagingDataset,
  fetchStagingDatasets,
  deleteStagingDataset,
  type StagingDataset,
} from '@/lib/api';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { isSupportedSpreadsheet } from '@/lib/spreadsheet-parser';

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const ACTIVE_STATUSES = new Set(['PENDING', 'SCANNING', 'PROCESSING']);

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  COMPLETED: 'default',
  PROCESSING: 'secondary',
  SCANNING: 'secondary',
  PENDING: 'outline',
  FAILED: 'destructive',
  CANCELLED: 'outline',
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function LargeLeadsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<StagingDataset | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['staging-datasets'],
    queryFn: fetchStagingDatasets,
    refetchInterval: (q) =>
      q.state.data?.data.some((d) => ACTIVE_STATUSES.has(d.status)) ? 3000 : false,
  });
  const datasets = data?.data ?? [];

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadStagingDataset(file),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['staging-datasets'] });
      router.push(`/large-leads/${res.datasetId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStagingDataset(id),
    onSuccess: () => {
      toast.success('Dataset deleted');
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ['staging-datasets'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!isSupportedSpreadsheet(file)) {
        toast.error('Please select a CSV, .xls, or .xlsx file');
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error('File size must be under 150 MB');
        return;
      }
      uploadMutation.mutate(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [uploadMutation],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Large Lead Data"
        description="Stage large datasets separately: upload, clean, deduplicate, categorize, then import selected leads."
        actions={
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {uploadMutation.isPending ? 'Uploading…' : 'Upload Dataset'}
          </Button>
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={handleFileSelect}
      />

      {uploadMutation.isPending && (
        <Card>
          <CardContent className="py-8 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Uploading and analyzing your file…</p>
              <p className="text-xs text-muted-foreground">
                Large files are uploaded directly to the server; this can take a few minutes.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : datasets.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No datasets yet"
          description="Upload a CSV or Excel file (up to 150 MB / 50,000+ leads) to clean, deduplicate and categorize it here before importing into Leads."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Datasets</CardTitle>
            <CardDescription>
              Uploaded datasets stay separate from your Leads until you import them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">Unique</TableHead>
                    <TableHead className="text-right">Duplicates</TableHead>
                    <TableHead className="text-right">Imported</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Uploaded</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datasets.map((d) => (
                    <TableRow
                      key={d.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/large-leads/${d.id}`)}
                    >
                      <TableCell className="font-medium max-w-[240px] truncate">{d.name}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[d.status] ?? 'outline'}>
                          {ACTIVE_STATUSES.has(d.status) && d.status !== 'PENDING' ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : null}
                          {d.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{d.totalRows.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{d.uniqueCount.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{d.duplicateCount.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{d.importedCount.toLocaleString()}</TableCell>
                      <TableCell>{formatBytes(d.sourceFileSize)}</TableCell>
                      <TableCell>{new Date(d.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(d);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this dataset?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.name}” and all {deleteTarget?.stagedCount.toLocaleString()} staged
              records will be permanently removed, along with the uploaded file. Leads already
              imported into your Leads module are not affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete Dataset'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
