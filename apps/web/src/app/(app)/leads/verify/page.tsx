'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ShieldCheck, Upload, ClipboardList, Loader2, History } from 'lucide-react';
import { toast } from 'sonner';

import {
  createVerificationBulkJob,
  fetchVerificationJobs,
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

export default function VerifyEmailsPage() {
  const router = useRouter();
  const [singleEmail, setSingleEmail] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [singleResult, setSingleResult] = useState<Awaited<ReturnType<typeof verifyEmail>> | null>(null);

  const { data: jobs } = useQuery({
    queryKey: ['verification-jobs'],
    queryFn: () => fetchVerificationJobs({ limit: 10 }),
  });

  const singleMutation = useMutation({
    mutationFn: () => verifyEmail(singleEmail),
    onSuccess: (result) => {
      setSingleResult(result);
      toast.success(`Verified: ${result.statusLabel ?? result.status}`);
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
    </div>
  );
}
