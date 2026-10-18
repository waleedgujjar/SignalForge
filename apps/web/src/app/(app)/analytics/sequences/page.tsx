'use client';

import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { AnalyticsRangePicker } from '@/components/analytics/analytics-range-picker';
import { AnalyticsTabs } from '@/components/analytics/analytics-shell';
import { AnalyticsExportButton } from '@/components/analytics/export-button';
import { formatRate, rateHint } from '@/components/analytics/kpi-card';
import { useAnalyticsRange } from '@/components/analytics/use-analytics-range';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fetchAnalyticsSequences, fetchAnalyticsSubjects, fetchCampaigns } from '@/lib/api';

const ALL_CAMPAIGNS = 'all';

export default function AnalyticsSequencesPage() {
  const { query, setQuery, setFilter } = useAnalyticsRange();

  const campaignsQuery = useQuery({
    queryKey: ['campaigns', 'analytics-filter'],
    queryFn: () => fetchCampaigns({ limit: '100' }),
  });

  const sequencesQuery = useQuery({
    queryKey: ['analytics', 'sequences', query],
    queryFn: () => fetchAnalyticsSequences(query),
  });

  const subjectsQuery = useQuery({
    queryKey: ['analytics', 'subjects', query],
    queryFn: () => fetchAnalyticsSubjects(query),
  });

  const steps = sequencesQuery.data?.steps ?? [];
  const subjects = subjectsQuery.data?.subjects ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sequence performance"
        description="How each step of your sequences performs once it starts sending."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={query.campaignId ?? ALL_CAMPAIGNS}
              onValueChange={(value) =>
                setFilter({ campaignId: value === ALL_CAMPAIGNS ? undefined : value })
              }
            >
              <SelectTrigger className="w-[200px]" aria-label="Filter by campaign">
                <SelectValue placeholder="All campaigns" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CAMPAIGNS}>All campaigns</SelectItem>
                {(campaignsQuery.data?.data ?? []).map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AnalyticsRangePicker value={query} onChange={setQuery} />
            <AnalyticsExportButton entity="sequences" query={query} />
          </div>
        }
      />

      <AnalyticsTabs />

      {sequencesQuery.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {sequencesQuery.error instanceof Error
              ? sequencesQuery.error.message
              : 'Sequence analytics could not be loaded.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Steps</CardTitle>
          <CardDescription>
            {sequencesQuery.data?.attributionNote ??
              'Replies are attributed to the most recent step sent before the reply arrived.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sequencesQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : steps.length === 0 ? (
            <EmptyState
              title="No step activity in this range"
              description="Once a sequence step sends its first message, its performance appears here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Step</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Bounce</TableHead>
                  <TableHead>Replies</TableHead>
                  <TableHead>Reply rate</TableHead>
                  <TableHead>Unsubscribes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {steps.map((step) => (
                  <TableRow key={step.stepId}>
                    <TableCell className="max-w-[180px] truncate">{step.campaignName}</TableCell>
                    <TableCell className="font-medium">Step {step.order}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">
                      {step.subject}
                    </TableCell>
                    <TableCell className="tabular-nums">{step.counters.sent}</TableCell>
                    <TableCell className="tabular-nums">{step.counters.delivered}</TableCell>
                    <TableCell className="tabular-nums">{step.rates.bounceRate}%</TableCell>
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Subject line performance</CardTitle>
          <CardDescription>
            {subjectsQuery.data?.note ?? 'Open tracking unavailable.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {subjectsQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : subjects.length === 0 ? (
            <EmptyState
              title="No subject data yet"
              description="Subject performance is grouped from messages that have already been sent."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Replies</TableHead>
                  <TableHead>Reply rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subjects.map((subject) => (
                  <TableRow key={subject.subject}>
                    <TableCell className="max-w-[420px] truncate font-medium">
                      {subject.subject}
                    </TableCell>
                    <TableCell className="tabular-nums">{subject.sent}</TableCell>
                    <TableCell className="tabular-nums">{subject.replies}</TableCell>
                    <TableCell className="text-muted-foreground" title={rateHint(subject.replyRate)}>
                      {formatRate(subject.replyRate)}
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
