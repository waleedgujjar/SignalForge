'use client';

import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { AnalyticsRangePicker } from '@/components/analytics/analytics-range-picker';
import { AnalyticsTabs } from '@/components/analytics/analytics-shell';
import { AnalyticsMetricCard } from '@/components/analytics/kpi-card';
import { useAnalyticsRange } from '@/components/analytics/use-analytics-range';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fetchAnalyticsDiscovery } from '@/lib/api';

export default function AnalyticsDiscoveryPage() {
  const { query, setQuery } = useAnalyticsRange();

  const discoveryQuery = useQuery({
    queryKey: ['analytics', 'discovery', query],
    queryFn: () => fetchAnalyticsDiscovery(query),
  });

  const data = discoveryQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discovery analytics"
        description="Lead discovery pipeline throughput and source breakdown."
        actions={<AnalyticsRangePicker value={query} onChange={setQuery} />}
      />

      <AnalyticsTabs />

      {discoveryQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {discoveryQuery.error instanceof Error
              ? discoveryQuery.error.message
              : 'Discovery analytics could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {discoveryQuery.isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <AnalyticsMetricCard
              label="Discovery jobs"
              value={data.totalJobs.toLocaleString()}
              hint={`${data.completed.toLocaleString()} completed`}
            />
            <AnalyticsMetricCard
              label="Businesses discovered"
              value={data.businessesDiscovered.toLocaleString()}
              hint={`${data.uniqueLeads.toLocaleString()} unique leads`}
            />
            <AnalyticsMetricCard
              label="Leads promoted"
              value={data.leadsPromoted.toLocaleString()}
              hint={`${data.leadsQualified.toLocaleString()} qualified`}
            />
            <AnalyticsMetricCard
              label="Emails found"
              value={data.emailsFound.toLocaleString()}
              hint={`${data.emailsVerified.toLocaleString()} verified`}
            />
            <AnalyticsMetricCard
              label="Duplicates removed"
              value={data.duplicatesRemoved.toLocaleString()}
              hint="Leads already in workspace"
              higherIsBetter={false}
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Jobs by source</CardTitle>
            </CardHeader>
            <CardContent>
              {data.bySource.length === 0 ? (
                <EmptyState
                  title="No discovery jobs in this period"
                  description="Run a lead discovery job to see source breakdowns here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Jobs</TableHead>
                      <TableHead>Discovered</TableHead>
                      <TableHead>Promoted</TableHead>
                      <TableHead>Qualified</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.bySource.map((row) => (
                      <TableRow key={row.source}>
                        <TableCell className="font-medium">{row.source}</TableCell>
                        <TableCell className="tabular-nums">{row.jobs}</TableCell>
                        <TableCell className="tabular-nums">{row.discovered}</TableCell>
                        <TableCell className="tabular-nums">{row.promoted}</TableCell>
                        <TableCell className="tabular-nums">{row.qualified}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
