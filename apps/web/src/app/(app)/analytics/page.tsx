'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { AnalyticsChart } from '@/components/analytics/analytics-chart';
import { AnalyticsRangePicker } from '@/components/analytics/analytics-range-picker';
import { AnalyticsTabs } from '@/components/analytics/analytics-shell';
import { AnalyticsExportButton } from '@/components/analytics/export-button';
import { FunnelChart } from '@/components/analytics/funnel-chart';
import { InsightsCard } from '@/components/analytics/insights-card';
import {
  AnalyticsKpiCard,
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
import { fetchAnalyticsOverview } from '@/lib/api';

export default function AnalyticsPage() {
  const { query, setQuery } = useAnalyticsRange();

  const overviewQuery = useQuery({
    queryKey: ['analytics', 'overview', query],
    queryFn: () => fetchAnalyticsOverview(query),
  });

  const overview = overviewQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Performance across leads, campaigns, replies, and sending infrastructure."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AnalyticsRangePicker value={query} onChange={setQuery} />
            <AnalyticsExportButton entity="campaigns" query={query} />
          </div>
        }
      />

      <AnalyticsTabs />

      {overviewQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {overviewQuery.error instanceof Error
              ? overviewQuery.error.message
              : 'Analytics could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {overviewQuery.isLoading || !overview ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {overview.kpis.map((card) => (
              <AnalyticsKpiCard key={card.key} card={card} />
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AnalyticsMetricCard
              label="Delivery rate"
              value={`${overview.rates.deliveryRate}%`}
              hint={`${overview.counters.delivered} of ${overview.counters.attempted} attempts`}
            />
            <AnalyticsMetricCard
              label="Bounce rate"
              value={`${overview.rates.bounceRate}%`}
              hint={`${overview.counters.hardBounces} hard / ${overview.counters.softBounces} soft`}
              higherIsBetter={false}
            />
            <AnalyticsMetricCard
              label="Reply rate"
              value={`${overview.rates.replyRate}%`}
              hint={`${overview.counters.uniqueRepliedLeads} leads replied`}
            />
            <AnalyticsMetricCard
              label="Positive reply rate"
              value={formatRate(overview.replies.positiveRateOfReplies)}
              hint={rateHint(overview.replies.positiveRateOfReplies)}
            />
          </div>

          {overview.counters.attempted === 0 ? (
            <EmptyState
              title="No sending activity in this period"
              description="Import leads and launch a campaign to start collecting analytics."
              className="rounded-lg border border-dashed border-border"
            />
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <AnalyticsChart
              title="Email volume"
              description="Daily sent, bounced, and failed messages."
              points={overview.timeline}
              series={[
                { key: 'sent', label: 'Sent', color: '#2563eb' },
                { key: 'bounced', label: 'Bounced', color: '#dc2626' },
                { key: 'failed', label: 'Failed', color: '#f59e0b' },
              ]}
            />
            <AnalyticsChart
              title="Rate trends"
              description="Daily delivery, bounce, and reply rates."
              points={overview.timeline}
              unit="%"
              series={[
                { key: 'deliveryRate', label: 'Delivery rate', color: '#16a34a' },
                { key: 'bounceRate', label: 'Bounce rate', color: '#dc2626' },
                { key: 'replyRate', label: 'Reply rate', color: '#2563eb' },
              ]}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <FunnelChart funnel={overview.funnel} />
            <InsightsCard insights={overview.insights} />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Top campaigns</CardTitle>
                  <CardDescription>Ranked by volume sent in this period.</CardDescription>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/analytics/campaigns">View all</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {overview.topCampaigns.length === 0 ? (
                <EmptyState
                  title="No campaign activity yet"
                  description="Create a campaign and enroll leads to see performance here."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Reply rate</TableHead>
                      <TableHead>Positive</TableHead>
                      <TableHead>Meetings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.topCampaigns.map((campaign) => (
                      <TableRow key={campaign.campaignId}>
                        <TableCell className="max-w-[240px] truncate font-medium">
                          <Link
                            href={`/analytics/campaigns/${campaign.campaignId}`}
                            className="hover:underline"
                          >
                            {campaign.name}
                          </Link>
                        </TableCell>
                        <TableCell className="tabular-nums">{campaign.counters.sent}</TableCell>
                        <TableCell className="tabular-nums">{campaign.rates.deliveryRate}%</TableCell>
                        <TableCell className="tabular-nums">{campaign.rates.replyRate}%</TableCell>
                        <TableCell className="tabular-nums">{campaign.positiveReplies}</TableCell>
                        <TableCell className="tabular-nums">{campaign.meetings}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What this dashboard cannot show</CardTitle>
              <CardDescription>
                These metrics are not tracked, so they are omitted rather than estimated.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {overview.limitations.map((limitation) => (
                  <li key={limitation} className="text-sm text-muted-foreground">
                    {limitation}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
