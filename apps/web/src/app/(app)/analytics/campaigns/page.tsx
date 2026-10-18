'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { AnalyticsRangePicker } from '@/components/analytics/analytics-range-picker';
import { AnalyticsTabs } from '@/components/analytics/analytics-shell';
import { AnalyticsExportButton } from '@/components/analytics/export-button';
import { formatRate, rateHint } from '@/components/analytics/kpi-card';
import { useAnalyticsRange } from '@/components/analytics/use-analytics-range';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { fetchAnalyticsCampaigns } from '@/lib/api';

export default function AnalyticsCampaignsPage() {
  const { query, setQuery } = useAnalyticsRange();

  const campaignsQuery = useQuery({
    queryKey: ['analytics', 'campaigns', query],
    queryFn: () => fetchAnalyticsCampaigns(query),
  });

  const campaigns = campaignsQuery.data?.campaigns ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaign performance"
        description="Sending and reply outcomes for every campaign active in the selected range."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AnalyticsRangePicker value={query} onChange={setQuery} />
            <AnalyticsExportButton entity="campaigns" query={query} />
          </div>
        }
      />

      <AnalyticsTabs />

      {campaignsQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {campaignsQuery.error instanceof Error
              ? campaignsQuery.error.message
              : 'Campaign analytics could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Campaigns</CardTitle>
          <CardDescription>
            Rates come from the same deliverability formulas used on the Deliverability page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {campaignsQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <EmptyState
              title="No campaign activity in this range"
              description="Launch a campaign, or widen the date range, to see performance here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Leads</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Bounce</TableHead>
                  <TableHead>Replies</TableHead>
                  <TableHead>Reply rate</TableHead>
                  <TableHead>Positive rate</TableHead>
                  <TableHead>Meetings</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.campaignId}>
                    <TableCell className="max-w-[220px] truncate font-medium">
                      {campaign.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{campaign.status}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{campaign.enrolledLeads}</TableCell>
                    <TableCell className="tabular-nums">{campaign.counters.sent}</TableCell>
                    <TableCell className="tabular-nums">{campaign.counters.delivered}</TableCell>
                    <TableCell className="tabular-nums">{campaign.rates.bounceRate}%</TableCell>
                    <TableCell className="tabular-nums">{campaign.counters.replies}</TableCell>
                    <TableCell className="tabular-nums">{campaign.rates.replyRate}%</TableCell>
                    <TableCell
                      className="text-muted-foreground"
                      title={rateHint(campaign.positiveReplyRate)}
                    >
                      {formatRate(campaign.positiveReplyRate)}
                    </TableCell>
                    <TableCell className="tabular-nums">{campaign.meetings}</TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/analytics/campaigns/${campaign.campaignId}`}>Details</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
