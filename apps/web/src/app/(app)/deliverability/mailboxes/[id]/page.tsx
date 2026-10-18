'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Play, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/dashboard/page-header';
import { DeliverabilityMetricCard } from '@/components/deliverability/deliverability-metric-cards';
import { DomainAuthPanel } from '@/components/deliverability/domain-auth-panel';
import { HealthScoreCard } from '@/components/deliverability/health-score-card';
import { MetricTrendChart } from '@/components/deliverability/metric-trend-chart';
import { PeriodSelect } from '@/components/deliverability/period-select';
import { ProtectionBadge } from '@/components/deliverability/health-tier-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  analyzeDeliverability,
  fetchDeliverabilityMailbox,
  fetchDeliverabilityMailboxTimeline,
  resumeMailboxSending,
  type DeliverabilityAnalysis,
  type DeliverabilityPeriod,
} from '@/lib/api';

export default function MailboxDeliverabilityPage() {
  const params = useParams<{ id: string }>();
  const mailboxId = params.id;
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<DeliverabilityPeriod>('7d');
  const [analysis, setAnalysis] = useState<DeliverabilityAnalysis | null>(null);

  const detailQuery = useQuery({
    queryKey: ['deliverability', 'mailbox', mailboxId, period],
    queryFn: () => fetchDeliverabilityMailbox(mailboxId, period),
  });

  const timelineQuery = useQuery({
    queryKey: ['deliverability', 'mailbox-timeline', mailboxId, period],
    queryFn: () => fetchDeliverabilityMailboxTimeline(mailboxId, period),
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeMailboxSending(mailboxId, 'Resumed from deliverability dashboard'),
    onSuccess: async () => {
      toast.success('Sending resumed for this mailbox');
      await queryClient.invalidateQueries({ queryKey: ['deliverability'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeDeliverability(mailboxId, period),
    onSuccess: (result) => setAnalysis(result),
    onError: (error: Error) => toast.error(error.message),
  });

  const detail = detailQuery.data;

  if (detailQuery.isLoading || !detail) {
    return (
      <>
        <PageHeader title="Mailbox deliverability" />
        <Skeleton className="h-80 w-full" />
      </>
    );
  }

  const canResume = detail.mailbox.protectionLevel !== 'NORMAL';

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/deliverability">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to deliverability
        </Link>
      </Button>

      <PageHeader
        title={detail.mailbox.emailAddress}
        description={`Status ${detail.mailbox.status} · Warmup ${detail.mailbox.warmupStatus} · Daily limit ${detail.mailbox.dailySendingLimit}`}
        actions={
          <div className="flex items-center gap-2">
            <PeriodSelect value={period} onChange={setPeriod} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/mailboxes/${mailboxId}`}>Mailbox settings</Link>
            </Button>
          </div>
        }
      />

      {canResume && (
        <Card className="border-yellow-500/40 bg-yellow-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Protection active</span>
                <ProtectionBadge level={detail.mailbox.protectionLevel} />
              </div>
              <p className="text-sm text-muted-foreground">
                {detail.mailbox.protectionReason ?? 'Sending is restricted for this mailbox.'}
              </p>
              {detail.mailbox.protectionUpdatedAt && (
                <p className="text-[11px] text-muted-foreground">
                  Since {new Date(detail.mailbox.protectionUpdatedAt).toLocaleString()}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={resumeMutation.isPending}
              onClick={() => resumeMutation.mutate()}
            >
              <Play className="mr-2 h-4 w-4" />
              Resume sending
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <HealthScoreCard
          score={detail.healthScore}
          tier={detail.tier}
          explanation={detail.scoreExplanation}
          components={detail.components}
          disclaimer={detail.disclaimer}
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          <DeliverabilityMetricCard
            label="Sent"
            value={String(detail.counters.sent)}
            hint={`${detail.counters.attempted} attempted`}
          />
          <DeliverabilityMetricCard
            label="Bounce rate"
            value={`${detail.rates.bounceRate}%`}
            hint={`${detail.counters.hardBounces} hard / ${detail.counters.softBounces} soft`}
          />
          <DeliverabilityMetricCard
            label="Failure rate"
            value={`${detail.rates.failureRate}%`}
            hint="Sending errors from this mailbox"
          />
          <DeliverabilityMetricCard
            label="Reply rate"
            value={`${detail.rates.replyRate}%`}
            hint={`${detail.counters.uniqueRepliedLeads} leads replied`}
          />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sending velocity</CardTitle>
          <CardDescription>
            Volume tracking against this mailbox&apos;s own baseline. Sudden jumps are worth a look
            before they turn into bounces.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <VelocityStat label="Today" value={`${detail.velocity.today} / ${detail.velocity.dailyLimit}`} />
            <VelocityStat label="Last hour" value={String(detail.velocity.lastHour)} />
            <VelocityStat label="Last 15 min" value={String(detail.velocity.last15Minutes)} />
            <VelocityStat label="Baseline / day" value={detail.velocity.baselinePerDay.toFixed(1)} />
          </div>
          {detail.velocity.anomalyDetected && detail.velocity.anomalyDescription && (
            <p className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm text-foreground">
              {detail.velocity.anomalyDescription}
            </p>
          )}
        </CardContent>
      </Card>

      {detail.domain && <DomainAuthPanel domain={detail.domain} />}

      <MetricTrendChart
        title="Daily trends"
        description="Rates for this mailbox over the selected period."
        points={timelineQuery.data?.points ?? []}
        unit="%"
        series={[
          { key: 'bounceRate', label: 'Bounce rate', color: '#dc2626' },
          { key: 'failureRate', label: 'Failure rate', color: '#f59e0b' },
          { key: 'replyRate', label: 'Reply rate', color: '#16a34a' },
        ]}
      />

      {detail.recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recommendations</CardTitle>
            <CardDescription>Rule-based actions for this mailbox.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {detail.recommendations.map((recommendation) => (
                <li key={recommendation} className="text-sm text-muted-foreground">
                  {recommendation}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                AI analysis
              </CardTitle>
              <CardDescription>
                Optional narrative summary of the metrics above. Advisory only — it never changes
                suppression or sending rules.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={analyzeMutation.isPending}
              onClick={() => analyzeMutation.mutate()}
            >
              {analyzeMutation.isPending ? 'Analyzing...' : 'Run analysis'}
            </Button>
          </div>
        </CardHeader>
        {analysis && (
          <CardContent className="space-y-3">
            <p className="text-sm text-foreground">{analysis.summary}</p>
            {analysis.investigationAreas.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Worth investigating
                </p>
                <ul className="space-y-1">
                  {analysis.investigationAreas.map((area) => (
                    <li key={area} className="text-sm text-muted-foreground">
                      {area}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.recommendations.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Suggestions
                </p>
                <ul className="space-y-1">
                  {analysis.recommendations.map((recommendation) => (
                    <li key={recommendation} className="text-sm text-muted-foreground">
                      {recommendation}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">
              {analysis.disclaimer}
            </p>
          </CardContent>
        )}
      </Card>
    </>
  );
}

function VelocityStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
