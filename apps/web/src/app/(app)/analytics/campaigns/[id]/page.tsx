'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { AnalyticsChart } from '@/components/analytics/analytics-chart';
import { AnalyticsRangePicker } from '@/components/analytics/analytics-range-picker';
import { FunnelChart } from '@/components/analytics/funnel-chart';
import {
  AnalyticsMetricCard,
  formatRate,
  rateHint,
} from '@/components/analytics/kpi-card';
import { useAnalyticsRange } from '@/components/analytics/use-analytics-range';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { fetchAnalyticsCampaignDetail } from '@/lib/api';

export default function AnalyticsCampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const { query, setQuery } = useAnalyticsRange();

  const detailQuery = useQuery({
    queryKey: ['analytics', 'campaign', campaignId, query],
    queryFn: () => fetchAnalyticsCampaignDetail(campaignId, query),
    enabled: Boolean(campaignId),
  });

  const detail = detailQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail?.campaign.name ?? 'Campaign analytics'}
        description="Performance, step breakdown, and reply outcomes for this campaign."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AnalyticsRangePicker value={query} onChange={setQuery} />
            <Button asChild variant="outline" size="sm">
              <Link href="/analytics/campaigns">All campaigns</Link>
            </Button>
          </div>
        }
      />

      {detailQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {detailQuery.error instanceof Error
              ? detailQuery.error.message
              : 'Campaign analytics could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {detailQuery.isLoading || !detail ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AnalyticsMetricCard
              label="Sent"
              value={(detail.summary?.counters.sent ?? 0).toLocaleString()}
              hint={`${detail.summary?.enrolledLeads ?? 0} leads enrolled`}
            />
            <AnalyticsMetricCard
              label="Delivery rate"
              value={`${detail.summary?.rates.deliveryRate ?? 0}%`}
              hint={`${detail.summary?.counters.delivered ?? 0} delivered`}
            />
            <AnalyticsMetricCard
              label="Reply rate"
              value={`${detail.summary?.rates.replyRate ?? 0}%`}
              hint={`${detail.replies.uniqueRepliedLeads} leads replied`}
            />
            <AnalyticsMetricCard
              label="Positive reply rate"
              value={formatRate(detail.replies.positiveRateOfReplies)}
              hint={rateHint(detail.replies.positiveRateOfReplies)}
            />
          </div>

          <AnalyticsChart
            title="Daily performance"
            description="Sent volume alongside bounce and reply outcomes."
            points={detail.timeline}
            series={[
              { key: 'sent', label: 'Sent', color: '#2563eb' },
              { key: 'replies', label: 'Replies', color: '#16a34a' },
              { key: 'bounced', label: 'Bounced', color: '#dc2626' },
            ]}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Step performance</CardTitle>
              <CardDescription>
                Replies are attributed to the most recent step sent before the reply arrived.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.steps.length === 0 ? (
                <EmptyState
                  title="No steps have sent yet"
                  description="Step metrics appear once the sequence starts delivering messages."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Step</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Delivered</TableHead>
                      <TableHead>Replies</TableHead>
                      <TableHead>Reply rate</TableHead>
                      <TableHead>Unsubscribes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.steps.map((step) => (
                      <TableRow key={step.stepId}>
                        <TableCell className="font-medium">Step {step.order}</TableCell>
                        <TableCell className="max-w-[280px] truncate text-muted-foreground">
                          {step.subject}
                        </TableCell>
                        <TableCell className="tabular-nums">{step.counters.sent}</TableCell>
                        <TableCell className="tabular-nums">{step.counters.delivered}</TableCell>
                        <TableCell className="tabular-nums">{step.counters.replies}</TableCell>
                        <TableCell className="tabular-nums">{step.rates.replyRate}%</TableCell>
                        <TableCell className="tabular-nums">{step.counters.unsubscribes}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <FunnelChart funnel={detail.funnel} />
        </>
      )}
    </div>
  );
}
