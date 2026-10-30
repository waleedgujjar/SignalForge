'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ShieldCheck, Upload, ClipboardList, Loader2, History, Mail, Search } from 'lucide-react';
import { toast } from 'sonner';

import {
  createVerificationBulkJob,
  fetchVerificationJobs,
  fetchVerificationHistory,
  uploadVerificationExcel,
  verifyEmail,
} from '@/lib/api';
import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { VerificationStatusBadge } from '@/components/verification/status-badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const RECENT_STATUSES = ['VERIFIED', 'RISKY', 'INVALID', 'UNKNOWN', 'DISPOSABLE', 'ROLE_BASED'];

export default function VerifyEmailsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [singleEmail, setSingleEmail] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [singleResult, setSingleResult] = useState<Awaited<ReturnType<typeof verifyEmail>> | null>(null);
  const [recentSearch, setRecentSearch] = useState('');
  const [recentSearchInput, setRecentSearchInput] = useState('');
  const [recentStatus, setRecentStatus] = useState('');

  const { data: jobs } = useQuery({
    queryKey: ['verification-jobs'],
    queryFn: () => fetchVerificationJobs({ limit: 10 }),
  });

  // Workspace-wide recent verified emails (no jobId) — includes single checks,
  // which never belong to a job, plus every email from bulk/Excel jobs.
  const { data: recentEmails, isLoading: recentLoading } = useQuery({
    queryKey: ['verification-recent-emails', recentStatus, recentSearch],
    queryFn: () =>
      fetchVerificationHistory({
        limit: 25,
        ...(recentStatus ? { status: recentStatus } : {}),
        ...(recentSearch ? { search: recentSearch } : {}),
      }),
    refetchInterval: 10_000,
  });

  const refreshRecent = () => {
    queryClient.invalidateQueries({ queryKey: ['verification-recent-emails'] });
    queryClient.invalidateQueries({ queryKey: ['verification-jobs'] });
  };

  const singleMutation = useMutation({
    mutationFn: () => verifyEmail(singleEmail),
    onSuccess: (result) => {
      setSingleResult(result);
      toast.success(`Verified: ${result.statusLabel ?? result.status}`);
      refreshRecent();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const emails = bulkText
        .split(/[\n,;]+/)
        .map((email) => email.trim())
        .filter((email) => email.includes('@'));
      if (emails.length === 0) throw new Error('Paste at least one email address');
      return createVerificationBulkJob({ emails, source: 'PASTE', name: 'Paste verification' });
    },
    onSuccess: (result) => {
      toast.success(`Verification job started (${result.total} emails)`);
      router.push(`/leads/verify/${result.jobId}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const excelMutation = useMutation({
    mutationFn: async (file: File) => {
      const data = await fileToBase64(file);
      return uploadVerificationExcel({
        file: { data, mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: file.name },
      });
    },
    onSuccess: (result) => {
      toast.success(`Excel job started (${result.total} emails)`);
      router.push(`/leads/verify/${result.jobId}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verify Emails"
        description="Check deliverability, catch risky addresses, and bulk-verify lead lists before sending."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Single email
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="single-email">Email address</Label>
              <Input
                id="single-email"
                value={singleEmail}
                onChange={(event) => setSingleEmail(event.target.value)}
                placeholder="person@company.com"
              />
            </div>
            <Button onClick={() => singleMutation.mutate()} disabled={!singleEmail || singleMutation.isPending}>
              {singleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Verify
            </Button>
            {singleResult && (
              <div className="rounded-md border p-3 text-sm space-y-2">
                <div className="flex items-center gap-2">
                  <VerificationStatusBadge status={singleResult.status} />
                  <span className="text-muted-foreground">Score {singleResult.score}</span>
                </div>
                <p>{singleResult.reason}</p>
                {singleResult.riskScore != null && (
                  <p className="text-muted-foreground">Risk {singleResult.riskScore} · Confidence {singleResult.confidenceScore ?? '—'}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" /> Paste bulk list
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder="One email per line, or comma-separated"
              rows={6}
            />
            <Button onClick={() => bulkMutation.mutate()} disabled={!bulkText.trim() || bulkMutation.isPending}>
              {bulkMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Start bulk job
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" /> Upload Excel / CSV
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={excelMutation.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) excelMutation.mutate(file);
              }}
            />
            <p className="mt-2 text-sm text-muted-foreground">
              We detect the email column automatically and append verification columns on export.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Recent jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Valid</TableHead>
                <TableHead>Risky</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(jobs?.data ?? []).map((job) => (
                <TableRow key={job.id}>
                  <TableCell>{job.name ?? job.source}</TableCell>
                  <TableCell>{job.status}</TableCell>
                  <TableCell>{job.completed}/{job.total}</TableCell>
                  <TableCell>{job.validCount}</TableCell>
                  <TableCell>{job.riskyCount}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => router.push(`/leads/verify/${job.id}`)}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> Recent emails
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search email…"
                className="w-[220px] pl-8"
                value={recentSearchInput}
                onChange={(event) => setRecentSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setRecentSearch(recentSearchInput.trim());
                }}
              />
            </div>
            <Select
              value={recentStatus || 'ALL'}
              onValueChange={(value) => setRecentStatus(value === 'ALL' ? '' : value)}
            >
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {RECENT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Company / Contact</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Verified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center">
                    <Loader2 className="inline h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : (recentEmails?.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    No verified emails yet. Verify a single email or upload a list to see results here.
                  </TableCell>
                </TableRow>
              ) : (
                (recentEmails?.data ?? []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.email}</TableCell>
                    <TableCell><VerificationStatusBadge status={entry.status} /></TableCell>
                    <TableCell className="text-sm">
                      {entry.company || entry.contact ? (
                        <span>{[entry.company, entry.contact].filter(Boolean).join(' · ')}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.source === 'SINGLE' ? 'Single check' : entry.jobId ? 'Uploaded / bulk' : '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(entry.checkedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
