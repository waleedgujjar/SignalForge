'use client';

import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { AnalyticsRangePicker } from '@/components/analytics/analytics-range-picker';
import { AnalyticsTabs } from '@/components/analytics/analytics-shell';
import {
  AnalyticsMetricCard,
  formatRate,
  rateHint,
} from '@/components/analytics/kpi-card';
import { useAnalyticsRange } from '@/components/analytics/use-analytics-range';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAnalyticsReplies } from '@/lib/api';

const CLASSIFICATION_LABELS: Record<string, string> = {
  POSITIVE: 'Positive',
  INTERESTED: 'Interested',
  NEGATIVE: 'Negative',
  NEUTRAL: 'Neutral',
  OUT_OF_OFFICE: 'Out of office',
  UNSUBSCRIBE: 'Unsubscribe',
  AUTO_REPLY: 'Auto reply',
  BOUNCE: 'Bounce notice',
  UNCLASSIFIED: 'Unclassified',
};

function formatHours(hours: number | null): string {
  if (hours === null) return 'Insufficient data';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export default function AnalyticsRepliesPage() {
  const { query, setQuery } = useAnalyticsRange();

  const repliesQuery = useQuery({
    queryKey: ['analytics', 'replies', query],
    queryFn: () => fetchAnalyticsReplies(query),
  });

  const data = repliesQuery.data;
  const totalReplies = data?.replies.totalReplies ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reply analytics"
        description="Classification, sentiment, and response speed for replies received in this range."
        actions={<AnalyticsRangePicker value={query} onChange={setQuery} />}
      />

      <AnalyticsTabs />

      {repliesQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {repliesQuery.error instanceof Error
              ? repliesQuery.error.message
              : 'Reply analytics could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {repliesQuery.isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AnalyticsMetricCard
              label="Total replies"
              value={data.replies.totalReplies.toLocaleString()}
              hint={`${data.replies.uniqueRepliedLeads} unique leads`}
            />
            <AnalyticsMetricCard
              label="Positive replies"
              value={data.replies.positive.toLocaleString()}
              hint={`${data.replies.negative} negative, ${data.replies.outOfOffice} out of office`}
            />
            <AnalyticsMetricCard
              label="Positive of replies"
              value={formatRate(data.replies.positiveRateOfReplies)}
              hint={rateHint(data.replies.positiveRateOfReplies)}
            />
            <AnalyticsMetricCard
              label="Positive of contacted"
              value={formatRate(data.replies.positiveRateOfContacted)}
              hint={rateHint(data.replies.positiveRateOfContacted)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Classification breakdown</CardTitle>
                <CardDescription>
                  Categories come from the reply classifier that already runs on inbound mail.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.replies.breakdown.length === 0 ? (
                  <EmptyState
                    title="No replies in this range"
                    description="Reply sentiment appears as soon as leads start responding."
                  />
                ) : (
                  data.replies.breakdown.map((entry) => (
                    <div key={entry.classification} className="space-y-1">
                      <div className="flex items-baseline justify-between text-sm">
                        <span>
                          {CLASSIFICATION_LABELS[entry.classification] ?? entry.classification}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {entry.count.toLocaleString()}
                          {totalReplies > 0
                            ? ` (${Math.round((entry.count / totalReplies) * 100)}%)`
                            : ''}
                        </span>
                      </div>
                      <Progress
                        value={totalReplies > 0 ? (entry.count / totalReplies) * 100 : 0}
                      />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Response time</CardTitle>
                  <CardDescription>
                    Measured from the first send to a lead until their first reply.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Median</p>
                    <p className="mt-1 text-2xl font-semibold">
                      {formatHours(data.replies.responseTime.medianHours)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Average</p>
                    <p className="mt-1 text-2xl font-semibold">
                      {formatHours(data.replies.responseTime.averageHours)}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Based on {data.replies.responseTime.sampleSize} replies with a matching send.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Meetings</CardTitle>
                  <CardDescription>
                    {data.meetings.manualEntryOnly
                      ? 'Meetings are recorded manually or through the API until a calendar integration exists.'
                      : 'Meetings recorded in this range.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Booked</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      {data.meetings.booked.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      Of positive replies
                    </p>
                    <p
                      className="mt-1 text-2xl font-semibold"
                      title={rateHint(data.meetings.meetingRateOfPositiveReplies)}
                    >
                      {formatRate(data.meetings.meetingRateOfPositiveReplies)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
