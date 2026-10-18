'use client';

import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { AnalyticsChart } from '@/components/analytics/analytics-chart';
import { AnalyticsRangePicker } from '@/components/analytics/analytics-range-picker';
import { AnalyticsTabs } from '@/components/analytics/analytics-shell';
import { AnalyticsMetricCard } from '@/components/analytics/kpi-card';
import { useAnalyticsRange } from '@/components/analytics/use-analytics-range';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAnalyticsWarmup } from '@/lib/api';

export default function AnalyticsWarmupPage() {
  const { query, setQuery } = useAnalyticsRange();

  const warmupQuery = useQuery({
    queryKey: ['analytics', 'warmup', query],
    queryFn: () => fetchAnalyticsWarmup(query),
  });

  const data = warmupQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warmup analytics"
        description="Warmup traffic is tracked separately and never counted in campaign metrics."
        actions={<AnalyticsRangePicker value={query} onChange={setQuery} />}
      />

      <AnalyticsTabs />

      {warmupQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {warmupQuery.error instanceof Error
              ? warmupQuery.error.message
              : 'Warmup analytics could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {warmupQuery.isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AnalyticsMetricCard
              label="Warmup sent"
              value={data.sent.toLocaleString()}
              hint={`${data.attempted} attempted of ${data.scheduled} scheduled`}
            />
            <AnalyticsMetricCard
              label="Failed"
              value={data.failed.toLocaleString()}
              hint="Warmup sends that errored"
              higherIsBetter={false}
            />
            <AnalyticsMetricCard
              label="Deferred"
              value={data.deferred.toLocaleString()}
              hint="Postponed by throttling or schedule"
              higherIsBetter={false}
            />
            <AnalyticsMetricCard
              label="Mailboxes warming"
              value={data.mailboxesWarming.toLocaleString()}
              hint="Active in this range"
            />
          </div>

          <AnalyticsChart
            title="Daily warmup volume"
            description={data.note}
            points={data.daily}
            variant="bar"
            series={[
              { key: 'sent', label: 'Sent', color: '#2563eb' },
              { key: 'failed', label: 'Failed', color: '#dc2626' },
            ]}
            emptyTitle="No warmup activity in this range"
            emptyDescription="Enable warmup on a mailbox to build sending reputation."
          />
        </>
      )}
    </div>
  );
}
