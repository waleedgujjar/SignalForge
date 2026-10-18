'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { AnalyticsRangePicker } from '@/components/analytics/analytics-range-picker';
import { AnalyticsTabs } from '@/components/analytics/analytics-shell';
import { AnalyticsExportButton } from '@/components/analytics/export-button';
import { useAnalyticsRange } from '@/components/analytics/use-analytics-range';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fetchAnalyticsMailboxes, fetchAnalyticsSmtpPools } from '@/lib/api';

export default function AnalyticsMailboxesPage() {
  const { query, setQuery } = useAnalyticsRange();

  const mailboxesQuery = useQuery({
    queryKey: ['analytics', 'mailboxes', query],
    queryFn: () => fetchAnalyticsMailboxes(query),
  });

  const poolsQuery = useQuery({
    queryKey: ['analytics', 'smtp-pools', query],
    queryFn: () => fetchAnalyticsSmtpPools(query),
  });

  const mailboxes = mailboxesQuery.data?.mailboxes ?? [];
  const pools = poolsQuery.data?.pools ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mailbox analytics"
        description="Sending volume and outcomes per mailbox and SMTP pool."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AnalyticsRangePicker value={query} onChange={setQuery} />
            <AnalyticsExportButton entity="mailboxes" query={query} />
          </div>
        }
      />

      <AnalyticsTabs />

      {mailboxesQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {mailboxesQuery.error instanceof Error
              ? mailboxesQuery.error.message
              : 'Mailbox analytics could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Mailboxes</CardTitle>
          <CardDescription>
            Health scores are the same values shown on the{' '}
            <Link href="/deliverability" className="underline underline-offset-2">
              Deliverability
            </Link>{' '}
            page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mailboxesQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : mailboxes.length === 0 ? (
            <EmptyState
              title="No mailbox activity in this range"
              description="Connect a mailbox and start a campaign to see per-mailbox performance."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mailbox</TableHead>
                  <TableHead>Pools</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Bounce</TableHead>
                  <TableHead>Failure</TableHead>
                  <TableHead>Reply rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mailboxes.map((mailbox) => (
                  <TableRow key={mailbox.mailboxId}>
                    <TableCell className="max-w-[240px] truncate font-medium">
                      {mailbox.emailAddress}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {mailbox.poolNames.length > 0 ? mailbox.poolNames.join(', ') : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{mailbox.healthScore}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{mailbox.counters.sent}</TableCell>
                    <TableCell className="tabular-nums">{mailbox.rates.deliveryRate}%</TableCell>
                    <TableCell className="tabular-nums">{mailbox.rates.bounceRate}%</TableCell>
                    <TableCell className="tabular-nums">{mailbox.rates.failureRate}%</TableCell>
                    <TableCell className="tabular-nums">{mailbox.rates.replyRate}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">SMTP pools</CardTitle>
          <CardDescription>Aggregated across every mailbox assigned to the pool.</CardDescription>
        </CardHeader>
        <CardContent>
          {poolsQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : pools.length === 0 ? (
            <EmptyState
              title="No pool activity in this range"
              description="Group mailboxes into an SMTP pool to compare pools side by side."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pool</TableHead>
                  <TableHead>Mailboxes</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Bounce</TableHead>
                  <TableHead>Reply rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pools.map((pool) => (
                  <TableRow key={pool.poolId}>
                    <TableCell className="font-medium">{pool.name}</TableCell>
                    <TableCell className="tabular-nums">{pool.mailboxCount}</TableCell>
                    <TableCell className="tabular-nums">{pool.counters.sent}</TableCell>
                    <TableCell className="tabular-nums">{pool.rates.deliveryRate}%</TableCell>
                    <TableCell className="tabular-nums">{pool.rates.bounceRate}%</TableCell>
                    <TableCell className="tabular-nums">{pool.rates.replyRate}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
