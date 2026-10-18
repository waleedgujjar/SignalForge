'use client';

import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { AnalyticsRangePicker } from '@/components/analytics/analytics-range-picker';
import { AnalyticsTabs } from '@/components/analytics/analytics-shell';
import { AnalyticsMetricCard } from '@/components/analytics/kpi-card';
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
import { fetchAnalyticsImports } from '@/lib/api';

export default function AnalyticsImportsPage() {
  const { query, setQuery } = useAnalyticsRange();

  const importsQuery = useQuery({
    queryKey: ['analytics', 'imports', query],
    queryFn: () => fetchAnalyticsImports(query),
  });

  const data = importsQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import analytics"
        description="How much of each import made it into your lead list."
        actions={<AnalyticsRangePicker value={query} onChange={setQuery} />}
      />

      <AnalyticsTabs />

      {importsQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {importsQuery.error instanceof Error
              ? importsQuery.error.message
              : 'Import analytics could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {importsQuery.isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AnalyticsMetricCard
              label="Imports"
              value={data.totalImports.toLocaleString()}
              hint={`${data.totalRows.toLocaleString()} rows processed`}
            />
            <AnalyticsMetricCard
              label="Leads imported"
              value={data.imported.toLocaleString()}
              hint="Rows that became leads"
            />
            <AnalyticsMetricCard
              label="Duplicates"
              value={data.duplicates.toLocaleString()}
              hint="Skipped because the lead already existed"
              higherIsBetter={false}
            />
            <AnalyticsMetricCard
              label="Errors"
              value={data.errors.toLocaleString()}
              hint={`${data.skipped.toLocaleString()} rows skipped`}
              higherIsBetter={false}
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Imports by source</CardTitle>
              <CardDescription>{data.coverageNote}</CardDescription>
            </CardHeader>
            <CardContent>
              {data.bySource.length === 0 ? (
                <EmptyState
                  title="No imports in this range"
                  description="Import leads from Google Drive or the API to see history here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Imports</TableHead>
                      <TableHead>Leads imported</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.bySource.map((row) => (
                      <TableRow key={row.source}>
                        <TableCell className="font-medium">{row.source}</TableCell>
                        <TableCell className="tabular-nums">{row.imports}</TableCell>
                        <TableCell className="tabular-nums">{row.imported}</TableCell>
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
