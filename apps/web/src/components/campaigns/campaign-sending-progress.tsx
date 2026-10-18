'use client';

import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchCampaignSendingStats } from '@/lib/api';

interface Props {
  campaignId: string;
}

export function CampaignSendingProgress({ campaignId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['campaign', campaignId, 'sending-stats'],
    queryFn: () => fetchCampaignSendingStats(campaignId),
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sending progress</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const total = data.total;
  const progress = total > 0 ? (data.sent / total) * 100 : 0;
  const limitProgress = data.dailyLimit ? Math.min(100, (data.sentToday / data.dailyLimit) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sending progress</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-4">
          <MetricCard label="Sent" value={data.sent} />
          <MetricCard label="Pending" value={data.pending} />
          <MetricCard label="Failed" value={data.failed} />
          <MetricCard label="Cancelled" value={data.cancelled} />
        </div>

        {total > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Overall completion</span>
              <span className="font-medium tabular-nums">
                {data.sent} / {total} ({progress.toFixed(0)}%)
              </span>
            </div>
            <Progress value={progress} />
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Today ({data.timezone})</span>
            <span className="font-medium tabular-nums">
              {data.sentToday}
              {data.dailyLimit ? ` / ${data.dailyLimit}` : ' (no cap)'}
            </span>
          </div>
          {data.dailyLimit && <Progress value={limitProgress} />}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
