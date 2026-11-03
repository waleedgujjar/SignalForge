'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Flame, Mail, ShieldAlert, Users } from 'lucide-react';

import { PageHeader } from '@/components/dashboard/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { EmptyState } from '@/components/dashboard/empty-state';
import { WarmupStatusBadge } from '@/components/warmup/warmup-status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  fetchWarmupAccounts,
  fetchWarmupStats,
  type DnsCheckStatus,
  type WarmupAccountSummary,
} from '@/lib/api';

function AuthBadge({ label, status }: { label: string; status: DnsCheckStatus | undefined }) {
  const s = status ?? 'NOT_CHECKED';
  const variant =
    s === 'PASS' ? 'default' : s === 'FAIL' || s === 'INVALID' ? 'destructive' : 'secondary';
  return (
    <Badge variant={variant} className="font-normal">
      {label}: {s === 'NOT_CHECKED' ? 'not checked' : s.toLowerCase()}
    </Badge>
  );
}

/// Why warmup is held for this account, if anything — surfaced as "Needs attention".
function attentionReason(account: WarmupAccountSummary): string | null {
  const a = account.auth;
  if (a && (a.dkimStatus === 'FAIL' || a.dkimStatus === 'INVALID')) {
    return `DKIM is ${a.dkimStatus.toLowerCase()} for ${a.domain} — enable DKIM before warming.`;
  }
  if (a && (a.spfStatus === 'FAIL' || a.spfStatus === 'INVALID')) {
    return `SPF is ${a.spfStatus.toLowerCase()} for ${a.domain}.`;
  }
  const h = account.health;
  if (h && (h.protectionLevel === 'AT_RISK' || h.protectionLevel === 'CRITICAL')) {
    return h.protectionReason ?? `Mailbox reputation is ${h.protectionLevel.toLowerCase()} — warmup is holding.`;
  }
  return null;
}

function groupByDomain(accounts: WarmupAccountSummary[]): Array<{ domain: string; accounts: WarmupAccountSummary[] }> {
  const map = new Map<string, WarmupAccountSummary[]>();
  for (const a of accounts) {
    const key = a.domain ?? 'Unknown domain';
    (map.get(key) ?? map.set(key, []).get(key)!).push(a);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([domain, list]) => ({ domain, accounts: list }));
}

export default function WarmupOverviewPage() {
  const stats = useQuery({ queryKey: ['warmup', 'stats'], queryFn: fetchWarmupStats });
  const accounts = useQuery({ queryKey: ['warmup', 'accounts'], queryFn: fetchWarmupAccounts });

  const activeCount = stats.data?.statusCounts.ACTIVE ?? 0;
  const pausedCount = stats.data?.statusCounts.PAUSED ?? 0;
  const blockedCount = stats.data?.statusCounts.BLOCKED ?? 0;
  const completedCount = stats.data?.statusCounts.COMPLETED ?? 0;
  const eligibleRecipients = stats.data?.eligibleRecipients ?? 0;

  return (
    <>
      <PageHeader
        title="Email Warmup"
        description="Gradually establish normal sending patterns for newly connected mailboxes. Warmup cannot guarantee inbox placement — it can only pace outbound volume."
        actions={
          <Button asChild variant="outline">
            <Link href="/warmup/recipients">
              <Users className="mr-2 h-4 w-4" />
              Warmup recipients
            </Link>
          </Button>
        }
      />

      {eligibleRecipients === 0 && !stats.isLoading && (
        <Alert className="mt-4" variant="default">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>No authorized warmup recipients</AlertTitle>
          <AlertDescription>
            Warmup emails will not be sent until you add authorized recipients who have consented to
            receive them. Warmup jobs will stay deferred with reason NO_WARMUP_RECIPIENTS.{' '}
            <Link href="/warmup/recipients" className="underline">
              Manage recipients
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active warmups" value={activeCount} icon={Flame} />
        <StatCard title="Paused" value={pausedCount} />
        <StatCard title="Blocked" value={blockedCount} />
        <StatCard title="Completed" value={completedCount} />
      </div>

      <div className="mt-6">
        <h2 className="text-lg font-semibold text-foreground">Domains &amp; mailboxes</h2>
        <p className="text-sm text-muted-foreground">
          Warmup runs per mailbox, grouped by sending domain. &ldquo;Accepted (SMTP)&rdquo; counts
          messages the receiving server accepted — not confirmed inbox placement. A domain with
          failing DKIM/SPF is held until its authentication is fixed.
        </p>
        {accounts.isLoading ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : accounts.data && accounts.data.length > 0 ? (
          <div className="mt-4 space-y-6">
            {groupByDomain(accounts.data).map(({ domain, accounts: domainAccounts }) => {
              const auth = domainAccounts.find((a) => a.auth)?.auth ?? null;
              return (
                <div key={domain}>
                  <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
                    <span className="font-medium text-foreground">{domain}</span>
                    {auth ? (
                      <>
                        <AuthBadge label="SPF" status={auth.spfStatus} />
                        <AuthBadge label="DKIM" status={auth.dkimStatus} />
                        <AuthBadge label="DMARC" status={auth.dmarcStatus} />
                      </>
                    ) : (
                      <Badge variant="secondary" className="font-normal">Authentication not checked yet</Badge>
                    )}
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {domainAccounts.map((account) => {
                      const config = account.config;
                      const status = (config?.status ?? 'NOT_STARTED') as never;
                      const currentLimit = config?.currentDailyLimit ?? 0;
                      const targetLimit = config?.maximumDailyLimit ?? account.mailbox.dailySendingLimit;
                      const usedToday = account.usage.warmupSentToday + account.usage.warmupReservedToday;
                      const percent =
                        currentLimit > 0 ? Math.min(100, Math.round((usedToday / currentLimit) * 100)) : 0;
                      const attention = attentionReason(account);
                      return (
                        <Card key={account.mailbox.id}>
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <CardTitle className="flex items-center gap-2 text-base">
                                  <Mail className="h-4 w-4 text-muted-foreground" />
                                  <span className="truncate">{account.mailbox.emailAddress}</span>
                                </CardTitle>
                                <CardDescription className="truncate">
                                  {account.mailbox.fromName}
                                </CardDescription>
                              </div>
                              <WarmupStatusBadge status={status} />
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {attention ? (
                              <div className="flex items-start gap-1.5 rounded-md border border-amber-300/50 bg-amber-50/50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>Needs attention: {attention}</span>
                              </div>
                            ) : null}
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Accepted (SMTP) today</span>
                              <span className="font-medium">
                                {usedToday} / {currentLimit || '—'}
                              </span>
                            </div>
                            <Progress value={percent} />
                            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                              <div>
                                Ramp target: <span className="font-medium text-foreground">{targetLimit}</span>/day
                              </div>
                              <div>
                                Account limit:{' '}
                                <span className="font-medium text-foreground">
                                  {account.mailbox.dailySendingLimit}
                                </span>
                                /day
                              </div>
                              {account.health ? (
                                <>
                                  <div>
                                    Hard bounces:{' '}
                                    <span className="font-medium text-foreground">{account.health.hardBounceCount}</span>
                                  </div>
                                  <div>
                                    Soft bounces:{' '}
                                    <span className="font-medium text-foreground">{account.health.softBounceCount}</span>
                                  </div>
                                </>
                              ) : null}
                            </div>
                            <div className="flex justify-end">
                              <Button asChild size="sm" variant="outline">
                                <Link href={`/warmup/${account.mailbox.id}`}>Manage warmup</Link>
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="No mailboxes to warm up"
              description="Add a mailbox in Infrastructure → Mailboxes to enable warmup."
            />
            <div className="mt-4 flex justify-center">
              <Button asChild>
                <Link href="/mailboxes">Manage mailboxes</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
