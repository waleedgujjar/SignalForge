'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { HealthTierBadge, ProtectionBadge } from './health-tier-badge';
import { fetchDeliverabilityMailbox } from '@/lib/api';

export function MailboxDeliverabilitySummary({ mailboxId }: { mailboxId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['deliverability', 'mailbox', mailboxId, '7d'],
    queryFn: () => fetchDeliverabilityMailbox(mailboxId, '7d'),
  });

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Deliverability</CardTitle>
            <CardDescription>Last 7 days of sending signals for this mailbox.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/deliverability/mailboxes/${mailboxId}`}>Full report</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat
                label="Health score"
                value={String(data.healthScore)}
                badge={<HealthTierBadge tier={data.tier} />}
              />
              <Stat label="Bounce rate" value={`${data.rates.bounceRate}%`} />
              <Stat label="Failure rate" value={`${data.rates.failureRate}%`} />
              <Stat label="Reply rate" value={`${data.rates.replyRate}%`} />
            </div>

            {data.mailbox.protectionLevel !== 'NORMAL' && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3">
                <ProtectionBadge level={data.mailbox.protectionLevel} />
                <span className="text-sm text-muted-foreground">
                  {data.mailbox.protectionReason ?? 'Sending is restricted for this mailbox.'}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {badge}
      </div>
    </div>
  );
}
