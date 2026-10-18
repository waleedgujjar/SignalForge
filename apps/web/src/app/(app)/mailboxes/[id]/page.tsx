'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import * as React from 'react';

import { MailboxDeliverabilitySummary } from '@/components/deliverability/mailbox-deliverability-summary';
import { MailboxHealthBadge } from '@/components/mailboxes/mailbox-health-badge';
import { MailboxStatusBadge } from '@/components/mailboxes/mailbox-status-badge';
import { PageHeader } from '@/components/dashboard/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  fetchMailbox,
  fetchMailboxInboundConfig,
  syncMailbox,
  testMailboxInbound,
  updateMailboxInboundConfig,
} from '@/lib/api';

export default function MailboxDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();

  const { data: mailbox, isLoading } = useQuery({
    queryKey: ['mailbox', id],
    queryFn: () => fetchMailbox(id),
  });

  const inboundQuery = useQuery({
    queryKey: ['mailbox', id, 'inbound'],
    queryFn: () => fetchMailboxInboundConfig(id),
  });

  const [enabled, setEnabled] = React.useState(false);
  const [imapHost, setImapHost] = React.useState('');
  const [imapPort, setImapPort] = React.useState('993');
  const [imapUsername, setImapUsername] = React.useState('');

  React.useEffect(() => {
    if (inboundQuery.data) {
      setEnabled(inboundQuery.data.inboundEnabled);
      setImapHost(inboundQuery.data.config?.imapHost ?? '');
      setImapPort(String(inboundQuery.data.config?.imapPort ?? 993));
      setImapUsername(inboundQuery.data.config?.imapUsername ?? mailbox?.emailAddress ?? '');
    }
  }, [inboundQuery.data, mailbox?.emailAddress]);

  const saveInboundMutation = useMutation({
    mutationFn: () =>
      updateMailboxInboundConfig(id, {
        enabled,
        imapHost: imapHost.trim() || undefined,
        imapPort: Number(imapPort) || undefined,
        imapUsername: imapUsername.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Inbound settings saved');
      queryClient.invalidateQueries({ queryKey: ['mailbox', id] });
      queryClient.invalidateQueries({ queryKey: ['mailbox', id, 'inbound'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const testMutation = useMutation({
    mutationFn: () => testMailboxInbound(id),
    onSuccess: (result) => {
      if (result.success) toast.success(result.message);
      else toast.error(result.message);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const syncMutation = useMutation({
    mutationFn: () => syncMailbox(id),
    onSuccess: (result) => {
      toast.success(
        `Sync complete — ${result.processed} processed, ${result.duplicates} duplicates`,
      );
      queryClient.invalidateQueries({ queryKey: ['mailbox', id] });
      queryClient.invalidateQueries({ queryKey: ['mailbox', id, 'inbound'] });
      queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !mailbox) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const usagePercent =
    mailbox.dailySendingLimit > 0
      ? Math.min(100, Math.round((mailbox.currentDailyUsage / mailbox.dailySendingLimit) * 100))
      : 0;

  const inbound = inboundQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={mailbox.name ?? mailbox.emailAddress}
        description={mailbox.emailAddress}
        actions={
          <div className="flex items-center gap-2">
            <MailboxStatusBadge status={mailbox.status} />
            <MailboxHealthBadge status={mailbox.healthStatus} />
            <Button asChild variant="outline">
              <Link href={`/mailboxes/${mailbox.id}/history`}>View test history</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/mailboxes">Back to accounts</Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Daily usage</div>
          <div className="mt-2">
            <Progress value={usagePercent} className="h-2" />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {mailbox.currentDailyUsage}/{mailbox.dailySendingLimit} sent today
          </div>
        </Card>
        <Card className="border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">SMTP host</div>
          <div className="mt-1 text-sm">
            {mailbox.smtpHost ? `${mailbox.smtpHost}:${mailbox.smtpPort ?? ''}` : 'Not configured'}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Encryption: {mailbox.encryptionType}</div>
        </Card>
        <Card className="border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Timezone</div>
          <div className="mt-1 text-sm">
            {mailbox.usage?.timezone ?? mailbox.timezone ?? 'Workspace default'}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Usage date: {mailbox.usage?.usageDate ?? '—'}
          </div>
        </Card>
      </div>

      <MailboxDeliverabilitySummary mailboxId={mailbox.id} />

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Inbound (IMAP) sync</CardTitle>
          <CardDescription>
            Connect IMAP to pull replies into the inbox. Uses the same mailbox credentials when
            testing stored settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {inbound?.lastInboundError && (
            <Alert variant="destructive">
              <AlertTitle>Last sync error</AlertTitle>
              <AlertDescription>{inbound.lastInboundError}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label htmlFor="inbound-enabled">Enable inbound sync</Label>
              <p className="text-xs text-muted-foreground">
                Status: {inbound?.inboundStatus ?? mailbox.inboundStatus ?? 'DISABLED'}
                {inbound?.lastInboundSyncAt &&
                  ` · Last sync ${new Date(inbound.lastInboundSyncAt).toLocaleString()}`}
              </p>
            </div>
            <Switch id="inbound-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="imap-host">IMAP host</Label>
              <Input
                id="imap-host"
                value={imapHost}
                onChange={(e) => setImapHost(e.target.value)}
                placeholder="imap.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="imap-port">IMAP port</Label>
              <Input
                id="imap-port"
                type="number"
                value={imapPort}
                onChange={(e) => setImapPort(e.target.value)}
                placeholder="993"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="imap-username">IMAP username</Label>
              <Input
                id="imap-username"
                value={imapUsername}
                onChange={(e) => setImapUsername(e.target.value)}
                placeholder={mailbox.emailAddress}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => saveInboundMutation.mutate()} disabled={saveInboundMutation.isPending}>
              Save inbound settings
            </Button>
            <Button
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
            >
              <Wifi className="mr-2 h-4 w-4" />
              Test connection
            </Button>
            <Button
              variant="outline"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending || !enabled}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync now
            </Button>
          </div>
        </CardContent>
      </Card>

      {mailbox.assignedCampaigns && mailbox.assignedCampaigns.length > 0 && (
        <Card className="border-border p-4">
          <div className="text-sm font-semibold">Assigned campaigns</div>
          <ul className="mt-2 space-y-1 text-sm">
            {mailbox.assignedCampaigns.map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <Link className="text-primary hover:underline" href={`/campaigns/${c.id}`}>
                  {c.name}
                </Link>
                <span className="text-xs text-muted-foreground">{c.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
