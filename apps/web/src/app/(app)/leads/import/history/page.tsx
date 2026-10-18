'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileSpreadsheet, Loader2 } from 'lucide-react';

import { fetchImportHistory } from '@/lib/api';
import type { ImportStatus, LeadSource } from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

function statusBadge(status: ImportStatus) {
  switch (status) {
    case 'COMPLETED':
      return <Badge variant="default" className="bg-green-600">Completed</Badge>;
    case 'PROCESSING':
      return <Badge variant="secondary">Processing</Badge>;
    case 'PENDING':
      return <Badge variant="outline">Pending</Badge>;
    case 'FAILED':
      return <Badge variant="destructive">Failed</Badge>;
    case 'CANCELLED':
      return <Badge variant="secondary">Cancelled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function sourceBadge(source: LeadSource) {
  switch (source) {
    case 'GOOGLE_DRIVE':
      return <Badge variant="outline" className="text-blue-600 border-blue-200">Google Drive</Badge>;
    case 'CSV_IMPORT':
      return <Badge variant="outline">CSV Upload</Badge>;
    default:
      return <Badge variant="outline">{source}</Badge>;
  }
}

export default function ImportHistoryPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['import-history', page],
    queryFn: () => fetchImportHistory({ page: String(page), limit: '20' }),
  });

  const imports = data?.imports ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/leads/import')}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Import
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <h1 className="text-xl font-semibold">Import History</h1>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : imports.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <FileSpreadsheet className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No imports yet.</p>
          <Button variant="link" size="sm" onClick={() => router.push('/leads/import')}>
            Import your first leads
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead className="text-right">Skipped</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.map((imp) => (
                  <TableRow key={imp.id}>
                    <TableCell className="text-sm">
                      {new Date(imp.createdAt).toLocaleDateString()}{' '}
                      <span className="text-muted-foreground">
                        {new Date(imp.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </TableCell>
                    <TableCell>{sourceBadge(imp.source)}</TableCell>
                    <TableCell>
                      <div className="max-w-[200px]">
                        {imp.files.slice(0, 2).map((f) => (
                          <p key={f.id} className="text-xs truncate text-muted-foreground">{f.sourceFileName}</p>
                        ))}
                        {imp.files.length > 2 && (
                          <p className="text-xs text-muted-foreground">+{imp.files.length - 2} more</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium text-green-600">
                      {imp.importedCount ?? 0}
                    </TableCell>
                    <TableCell className="text-right text-yellow-600">
                      {imp.skippedCount ?? 0}
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      {imp.errorCount ?? 0}
                    </TableCell>
                    <TableCell>{statusBadge(imp.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} imports)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
