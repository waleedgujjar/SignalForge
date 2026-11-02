'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  previewVerificationFile,
  uploadVerificationFile,
  type VerificationFilePreview,
  type VerificationUploadResult,
} from '@/lib/api';

const REASON_LABEL: Record<VerificationFilePreview['candidates'][number]['reason'], string> = {
  header: 'email column',
  'header-generic': 'email column',
  content: 'contains emails',
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' | 'muted' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-foreground';
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}

/**
 * Upload a CSV/XLS/XLSX for bulk verification in two steps: the file is read
 * first and the detected email column, counts and a sample are shown (the
 * column can be changed); verification starts only after the user confirms.
 */
export function VerificationFileUploadCard({ onStarted }: { onStarted: (result: VerificationUploadResult) => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<VerificationFilePreview | null>(null);

  const previewMutation = useMutation({
    mutationFn: (input: { file: File; emailColumn?: string }) =>
      previewVerificationFile(input.file, input.emailColumn ? { emailColumn: input.emailColumn } : undefined),
    onSuccess: setPreview,
    onError: (error: Error) => {
      setPreview(null);
      toast.error(error.message, { duration: 10_000 });
    },
  });

  const startMutation = useMutation({
    mutationFn: () => uploadVerificationFile(file!, { emailColumn: preview!.emailColumn }),
    onSuccess: (result) => {
      toast.success(`Verifying ${result.total.toLocaleString()} unique emails from the "${result.emailColumn}" column`);
      reset();
      onStarted(result);
    },
    onError: (error: Error) => toast.error(error.message, { duration: 10_000 }),
  });

  function reset() {
    setFile(null);
    setPreview(null);
  }

  const busy = previewMutation.isPending || startMutation.isPending;
  const columnOptions = preview
    ? [
        ...preview.candidates.map((c) => ({
          value: c.header,
          label: `${c.header} — ${c.valid} valid${c.valid ? '' : ' (no emails)'} · ${REASON_LABEL[c.reason]}`,
        })),
        ...preview.headers
          .filter((h) => !preview.candidates.some((c) => c.header === h))
          .map((h) => ({ value: h, label: h })),
      ]
    : [];

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="h-4 w-4" /> Upload Excel / CSV
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!file ? (
          <>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={busy}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                // Clear so choosing the same file again (after fixing it) re-triggers.
                event.target.value = '';
                if (!chosen) return;
                setFile(chosen);
                previewMutation.mutate({ file: chosen });
              }}
            />
            <p className="text-sm text-muted-foreground">
              CSV, XLS or XLSX. We find the email column (Email, Gmail, Business Email, …), show you what was found,
              and start only when you confirm. Website and map links are never treated as emails.
            </p>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-3">
              <FileSpreadsheet className="h-6 w-6 shrink-0 text-green-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <Button variant="ghost" size="sm" onClick={reset} disabled={startMutation.isPending} aria-label="Remove file">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {previewMutation.isPending && !preview ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading file…
              </div>
            ) : null}

            {preview ? (
              <>
                <div className="space-y-2">
                  <Label>Email column</Label>
                  <div className="flex items-center gap-2">
                    <Select
                      value={preview.emailColumn}
                      onValueChange={(column) => previewMutation.mutate({ file, emailColumn: column })}
                      disabled={busy}
                    >
                      <SelectTrigger className="w-full sm:w-96">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {columnOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {previewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  </div>
                  {preview.ambiguous ? (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      More than one column looks like an email column. Check that &ldquo;{preview.emailColumn}&rdquo; is
                      the one you want.
                    </p>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Stat label="Rows" value={preview.rowCount} />
                  <Stat label="Valid emails" value={preview.validRows} tone="good" />
                  <Stat label="Unique to verify" value={preview.uniqueEmails} tone="good" />
                  <Stat label="Invalid values" value={preview.invalidRows} tone={preview.invalidRows ? 'warn' : undefined} />
                  <Stat label="Empty" value={preview.emptyRows} />
                </div>
                {preview.duplicateEmails || preview.fallbackRows ? (
                  <p className="text-xs text-muted-foreground">
                    {preview.duplicateEmails ? `${preview.duplicateEmails} duplicate rows are verified once. ` : ''}
                    {preview.fallbackRows
                      ? `${preview.fallbackRows} rows had no value in "${preview.emailColumn}" and use another email column.`
                      : ''}
                  </p>
                ) : null}

                {preview.preview.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Preview</p>
                    <ul className="space-y-0.5 rounded-md border border-border bg-muted/20 p-2 font-mono text-xs">
                      {preview.preview.map((email) => (
                        <li key={email} className="truncate">
                          {email}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {preview.invalidSamples.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Skipped (not email addresses)</p>
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {preview.invalidSamples.map((value, i) => (
                        <li key={i} className="truncate" title={value}>
                          {value}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => startMutation.mutate()} disabled={busy || preview.uniqueEmails === 0}>
                    {startMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Start verification ({preview.uniqueEmails.toLocaleString()})
                  </Button>
                  <Button variant="outline" onClick={reset} disabled={startMutation.isPending}>
                    Cancel
                  </Button>
                </div>
                {preview.uniqueEmails === 0 ? (
                  <p className="text-sm text-destructive">
                    No valid email addresses in &ldquo;{preview.emailColumn}&rdquo;. Choose another column.
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
