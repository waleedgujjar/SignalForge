'use client';

import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { AnalyticsRangePicker } from '@/components/analytics/analytics-range-picker';
import { AnalyticsTabs } from '@/components/analytics/analytics-shell';
import { AnalyticsExportButton } from '@/components/analytics/export-button';
import { FunnelChart } from '@/components/analytics/funnel-chart';
import {
  AnalyticsMetricCard,
  formatRate,
  rateHint,
} from '@/components/analytics/kpi-card';
import { useAnalyticsRange } from '@/components/analytics/use-analytics-range';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { fetchAnalyticsLeads } from '@/lib/api';

export default function AnalyticsLeadsPage() {
  const { query, setQuery } = useAnalyticsRange();

  const leadsQuery = useQuery({
    queryKey: ['analytics', 'leads', query],
    queryFn: () => fetchAnalyticsLeads(query),
  });

  const data = leadsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lead analytics"
        description="Funnel progression and verification quality for leads added in this range."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AnalyticsRangePicker value={query} onChange={setQuery} />
            <AnalyticsExportButton entity="funnel" query={query} />
          </div>
        }
      />

      <AnalyticsTabs />

      {leadsQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {leadsQuery.error instanceof Error
              ? leadsQuery.error.message
              : 'Lead analytics could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {leadsQuery.isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AnalyticsMetricCard
              label="Leads added"
              value={data.verification.total.toLocaleString()}
              hint="Created in the selected range"
            />
            <AnalyticsMetricCard
              label="Verified"
              value={data.verification.verified.toLocaleString()}
              hint={`${data.verification.invalid} invalid, ${data.verification.risky} risky`}
            />
            <AnalyticsMetricCard
              label="Verification rate"
              value={formatRate(data.verification.verificationRate)}
              hint={rateHint(data.verification.verificationRate)}
            />
            <AnalyticsMetricCard
              label="Unverified"
              value={data.verification.unknown.toLocaleString()}
              hint="No verification result recorded yet"
              higherIsBetter={false}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <FunnelChart funnel={data.funnel} />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Verification quality</CardTitle>
                <CardDescription>
                  Results from the verification pipeline, not an estimate.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Result</TableHead>
                      <TableHead>Leads</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { label: 'Verified', value: data.verification.verified },
                      { label: 'Invalid', value: data.verification.invalid },
                      { label: 'Risky', value: data.verification.risky },
                      { label: 'Disposable', value: data.verification.disposable },
                      { label: 'Role-based', value: data.verification.roleBased },
                      { label: 'Not verified', value: data.verification.unknown },
                    ].map((row) => (
                      <TableRow key={row.label}>
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell className="tabular-nums">{row.value.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
