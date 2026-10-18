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
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAnalyticsWebsiteIntelligence } from '@/lib/api';

export default function AnalyticsWebsiteIntelligencePage() {
  const { query, setQuery } = useAnalyticsRange();

  const websiteQuery = useQuery({
    queryKey: ['analytics', 'website-intelligence', query],
    queryFn: () => fetchAnalyticsWebsiteIntelligence(query),
  });

  const data = websiteQuery.data;
  const analyzed = data?.analyzed ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Website intelligence"
        description="How the websites analysed in this range are distributed by opportunity."
        actions={<AnalyticsRangePicker value={query} onChange={setQuery} />}
      />

      <AnalyticsTabs />

      {websiteQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {websiteQuery.error instanceof Error
              ? websiteQuery.error.message
              : 'Website intelligence could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {websiteQuery.isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <AnalyticsMetricCard
              label="Websites analysed"
              value={data.analyzed.toLocaleString()}
              hint="Completed analyses in this range"
            />
            <AnalyticsMetricCard
              label="Average website score"
              value={data.averageWebsiteScore === null ? 'Insufficient data' : String(data.averageWebsiteScore)}
              hint="Higher means a healthier site"
            />
            <AnalyticsMetricCard
              label="Average opportunity score"
              value={
                data.averageOpportunityScore === null
                  ? 'Insufficient data'
                  : String(data.averageOpportunityScore)
              }
              hint="Higher means a stronger pitch angle"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">By opportunity priority</CardTitle>
                <CardDescription>Priority assigned during website analysis.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.byPriority.length === 0 ? (
                  <EmptyState
                    title="No analyses in this range"
                    description="Run website analysis on your leads to segment them by opportunity."
                  />
                ) : (
                  data.byPriority.map((entry) => (
                    <div key={entry.priority} className="space-y-1">
                      <div className="flex items-baseline justify-between text-sm">
                        <span>{entry.priority}</span>
                        <span className="tabular-nums text-muted-foreground">{entry.count}</span>
                      </div>
                      <Progress value={analyzed > 0 ? (entry.count / analyzed) * 100 : 0} />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">By website score</CardTitle>
                <CardDescription>Sites grouped into score bands.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.byScoreBucket.length === 0 ? (
                  <EmptyState
                    title="No scored websites yet"
                    description="Scores appear once website analysis completes for a lead."
                  />
                ) : (
                  data.byScoreBucket.map((entry) => (
                    <div key={entry.bucket} className="space-y-1">
                      <div className="flex items-baseline justify-between text-sm">
                        <span>{entry.bucket}</span>
                        <span className="tabular-nums text-muted-foreground">{entry.count}</span>
                      </div>
                      <Progress value={analyzed > 0 ? (entry.count / analyzed) * 100 : 0} />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
