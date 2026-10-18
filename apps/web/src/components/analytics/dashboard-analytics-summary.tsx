'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRate } from '@/components/analytics/kpi-card';
import { fetchAnalyticsOverview, type AnalyticsQuery } from '@/lib/api';

const LAST_7_DAYS: AnalyticsQuery = { period: '7d' };

/// Compact read-only strip on the dashboard. The full breakdown lives at
/// /analytics; this only surfaces the four headline numbers.
export function DashboardAnalyticsSummary() {
  const overviewQuery = useQuery({
    queryKey: ['analytics', 'overview', LAST_7_DAYS],
    queryFn: () => fetchAnalyticsOverview(LAST_7_DAYS),
  });

  const overview = overviewQuery.data;

  const tiles = [
    { label: 'Emails sent', value: overview ? overview.counters.sent.toLocaleString() : '—' },
    { label: 'Delivery rate', value: overview ? `${overview.rates.deliveryRate}%` : '—' },
    { label: 'Replies', value: overview ? overview.counters.replies.toLocaleString() : '—' },
    {
      label: 'Positive replies',
      value: overview ? formatRate(overview.replies.positiveRateOfReplies) : '—',
    },
  ];

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold">Last 7 days</CardTitle>
            <CardDescription>Outbound performance at a glance</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/analytics">Open analytics</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {overviewQuery.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((tile) => (
              <Skeleton key={tile.label} className="h-14" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tiles.map((tile) => (
              <div key={tile.label}>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {tile.label}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
