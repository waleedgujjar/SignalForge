'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/dashboard/page-header';
import { AlertList } from '@/components/deliverability/alert-list';
import { DeliverabilityMetricCard } from '@/components/deliverability/deliverability-metric-cards';
import { HealthScoreCard } from '@/components/deliverability/health-score-card';
import { MailboxHealthTable } from '@/components/deliverability/mailbox-health-table';
import { MetricTrendChart } from '@/components/deliverability/metric-trend-chart';
import { PeriodSelect } from '@/components/deliverability/period-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  downloadDeliverabilityExport,
  fetchDeliverabilityAlerts,
  fetchDeliverabilityMailboxes,
  fetchDeliverabilityOverview,
  fetchDeliverabilityTimeline,
  type DeliverabilityPeriod,
} from '@/lib/api';

export default function DeliverabilityPage() {
  const [period, setPeriod] = useState<DeliverabilityPeriod>('7d');
  const [exporting, setExporting] = useState(false);

  const overviewQuery = useQuery({
    queryKey: ['deliverability', 'overview', period],
    queryFn: () => fetchDeliverabilityOverview(period),
  });

  const timelineQuery = useQuery({
    queryKey: ['deliverability', 'timeline', period],
    queryFn: () => fetchDeliverabilityTimeline(period),
  });

  const mailboxesQuery = useQuery({
    queryKey: ['deliverability', 'mailboxes', period],
    queryFn: () => fetchDeliverabilityMailboxes(period),
  });

  const alertsQuery = useQuery({
    queryKey: ['deliverability', 'alerts', { status: 'OPEN' as const, limit: 5 }],
    queryFn: () => fetchDeliverabilityAlerts({ status: 'OPEN', limit: 5 }),
  });

  const overview = overviewQuery.data;

  const handleExport = async () => {
    setExporting(true);
    try {
      const { filename, csv } = await downloadDeliverabilityExport('mailboxes', period);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Deliverability"
        description="Measurable sending health across your mailboxes and campaigns."
        actions={
          <div className="flex items-center gap-2">
            <PeriodSelect value={period} onChange={setPeriod} />
            <Button variant="outline" size="sm" disabled={exporting} onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/deliverability/settings">Protection settings</Link>
            </Button>
          </div>
        }
      />

      {overviewQuery.isLoading || !overview ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-1" />
          <Skeleton className="h-72 lg:col-span-2" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <HealthScoreCard
              score={overview.healthScore}
              tier={overview.tier}
              explanation={overview.scoreExplanation}
              components={overview.components}
              disclaimer={overview.disclaimer}
            />

            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
              <DeliverabilityMetricCard
                label="Sent"
                value={String(overview.counters.sent)}
                trend={overview.trends.sent}
                higherIsBetter
                hint={`${overview.counters.attempted} attempted`}
              />
              <DeliverabilityMetricCard
                label="Bounce rate"
                value={`${overview.rates.bounceRate}%`}
                trend={overview.trends.bounceRate}
                hint={`${overview.counters.hardBounces} hard / ${overview.counters.softBounces} soft`}
              />
              <DeliverabilityMetricCard
                label="Failure rate"
                value={`${overview.rates.failureRate}%`}
                trend={overview.trends.failureRate}
                hint="Sending errors, not recipient rejections"
              />
              <DeliverabilityMetricCard
                label="Reply rate"
                value={`${overview.rates.replyRate}%`}
                trend={overview.trends.replyRate}
                higherIsBetter
                hint={`${overview.counters.uniqueRepliedLeads} leads replied`}
              />
              <DeliverabilityMetricCard
                label="Unsubscribe rate"
                value={`${overview.rates.unsubscribeRate}%`}
                trend={overview.trends.unsubscribeRate}
                hint={`${overview.counters.unsubscribes} unsubscribes`}
              />
              <DeliverabilityMetricCard
                label="Mailboxes needing attention"
                value={String(
                  overview.mailboxSummary.needsAttention +
                    overview.mailboxSummary.atRisk +
                    overview.mailboxSummary.critical,
                )}
                hint={`${overview.mailboxSummary.total} total, ${overview.mailboxSummary.paused} paused`}
              />
            </div>
          </div>

          {!overview.complaintDataAvailable && (
            <p className="text-xs text-muted-foreground">
              Spam complaint rate is not shown because no provider feedback loop is connected.
              Complaint data cannot be inferred from SMTP responses.
            </p>
          )}

          {overview.recommendations.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="h-4 w-4" />
                  Recommendations
                </CardTitle>
                <CardDescription>
                  Rule-based suggestions derived from the metrics above.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {overview.recommendations.map((recommendation) => (
                    <li key={recommendation} className="text-sm text-muted-foreground">
                      {recommendation}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <MetricTrendChart
          title="Delivery volume"
          description="Daily sent, bounced, and failed messages."
          points={timelineQuery.data?.points ?? []}
          series={[
            { key: 'sent', label: 'Sent', color: '#2563eb' },
            { key: 'bounced', label: 'Bounced', color: '#dc2626' },
            { key: 'failed', label: 'Failed', color: '#f59e0b' },
          ]}
        />
        <MetricTrendChart
          title="Rate trends"
          description="Daily bounce, failure, and reply rates."
          points={timelineQuery.data?.points ?? []}
          unit="%"
          series={[
            { key: 'bounceRate', label: 'Bounce rate', color: '#dc2626' },
            { key: 'failureRate', label: 'Failure rate', color: '#f59e0b' },
            { key: 'replyRate', label: 'Reply rate', color: '#16a34a' },
          ]}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Mailbox health</CardTitle>
              <CardDescription>
                {mailboxesQuery.data?.disclaimer ?? 'Health reflects your own sending signals only.'}
              </CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/deliverability/campaigns">Campaign health</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {mailboxesQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <MailboxHealthTable mailboxes={mailboxesQuery.data?.mailboxes ?? []} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Open alerts</CardTitle>
              <CardDescription>Signals that crossed a configured threshold.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/deliverability/alerts">View all</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {alertsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <AlertList alerts={alertsQuery.data?.alerts ?? []} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
