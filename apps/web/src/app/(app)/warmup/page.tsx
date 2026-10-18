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
import { fetchWarmupAccounts, fetchWarmupStats } from '@/lib/api';

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
        <h2 className="text-lg font-semibold text-foreground">Mailboxes</h2>
        <p className="text-sm text-muted-foreground">
          Enable warmup on individual mailboxes. Warmup capacity is shared with campaign sending on
          the same account.
        </p>
        {accounts.isLoading ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : accounts.data && accounts.data.length > 0 ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {accounts.data.map((account) => {
              const config = account.config;
              const status = (config?.status ?? 'NOT_STARTED') as never;
              const currentLimit = config?.currentDailyLimit ?? 0;
              const targetLimit = config?.maximumDailyLimit ?? account.mailbox.dailySendingLimit;
              const usedToday = account.usage.warmupSentToday + account.usage.warmupReservedToday;
              const percent =
                currentLimit > 0 ? Math.min(100, Math.round((usedToday / currentLimit) * 100)) : 0;
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
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Sent today
                      </span>
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
