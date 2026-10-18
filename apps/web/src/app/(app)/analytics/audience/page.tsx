'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { AnalyticsRangePicker } from '@/components/analytics/analytics-range-picker';
import { AnalyticsTabs } from '@/components/analytics/analytics-shell';
import { AnalyticsExportButton } from '@/components/analytics/export-button';
import { DimensionTable } from '@/components/analytics/dimension-table';
import { useAnalyticsRange } from '@/components/analytics/use-analytics-range';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchAnalyticsDimension } from '@/lib/api';

type Dimension = 'sources' | 'industries' | 'geography' | 'job-titles' | 'company-sizes';

type DimensionConfig = {
  tab: string;
  title: string;
  column: string;
  description: string;
  /// Company size is derived at query time and has no CSV exporter.
  exportEntity?: 'sources' | 'industries' | 'geography' | 'job-titles';
};

const DIMENSIONS: Record<Dimension, DimensionConfig> = {
  sources: {
    tab: 'Sources',
    title: 'Lead source performance',
    column: 'Source',
    description: 'Where each lead came from, as recorded at import time.',
    exportEntity: 'sources',
  },
  industries: {
    tab: 'Industries',
    title: 'Industry performance',
    column: 'Industry',
    description: 'Grouped by the industry stored on the lead record.',
    exportEntity: 'industries',
  },
  geography: {
    tab: 'Geography',
    title: 'Country performance',
    column: 'Country',
    description: 'Grouped by the country stored on the lead record.',
    exportEntity: 'geography',
  },
  'job-titles': {
    tab: 'Job titles',
    title: 'Job title performance',
    column: 'Job title',
    description: 'Grouped by the job title stored on the lead record.',
    exportEntity: 'job-titles',
  },
  'company-sizes': {
    tab: 'Company size',
    title: 'Company size performance',
    column: 'Employees',
    description: 'Derived from enrichment data, so coverage depends on how many leads are enriched.',
  },
};

export default function AnalyticsAudiencePage() {
  const { query, setQuery } = useAnalyticsRange();
  const [dimension, setDimension] = useState<Dimension>('sources');

  const config = DIMENSIONS[dimension];

  const dimensionQuery = useQuery({
    queryKey: ['analytics', 'dimension', dimension, query],
    queryFn: () => fetchAnalyticsDimension(dimension, query),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audience breakdown"
        description="Which segments of your list actually respond."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AnalyticsRangePicker value={query} onChange={setQuery} />
            {config.exportEntity ? (
              <AnalyticsExportButton entity={config.exportEntity} query={query} />
            ) : null}
          </div>
        }
      />

      <AnalyticsTabs />

      <Tabs value={dimension} onValueChange={(value) => setDimension(value as Dimension)}>
        <TabsList>
          {Object.entries(DIMENSIONS).map(([value, entry]) => (
            <TabsTrigger key={value} value={value}>
              {entry.tab}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {dimensionQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {dimensionQuery.error instanceof Error
              ? dimensionQuery.error.message
              : 'This breakdown could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{config.title}</CardTitle>
          <CardDescription>{dimensionQuery.data?.note ?? config.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {dimensionQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : (
            <DimensionTable
              label={config.column}
              rows={dimensionQuery.data?.rows ?? []}
              emptyTitle="No leads in this range"
              emptyDescription="Import leads or widen the date range to see this breakdown."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
