'use client';

import { CheckCircle2, Circle, Clock, MessageCircle, XCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { fetchLeadSequenceStatus, type LeadSequenceStatus } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

function stateIcon(state: LeadSequenceStatus['steps'][0]['state']) {
  switch (state) {
    case 'sent':
      return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    case 'scheduled':
      return <Clock className="h-4 w-4 text-amber-600" />;
    case 'cancelled':
    case 'failed':
      return <XCircle className="h-4 w-4 text-destructive" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'Pending';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function LeadSequenceTimeline({
  campaignId,
  leadId,
}: {
  campaignId: string;
  leadId: string;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['campaign', campaignId, 'lead-sequence', leadId],
    queryFn: () => fetchLeadSequenceStatus(campaignId, leadId),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError || !data) {
    return <p className="text-sm text-muted-foreground">Unable to load sequence progress.</p>;
  }

  const stopped = Boolean(data.stopReason);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sequence progress</CardTitle>
        <CardDescription>
          {data.leadName ?? data.leadEmail} · {data.campaignName}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{data.status}</Badge>
          {stopped && (
            <Badge variant="outline" className="gap-1">
              <MessageCircle className="h-3 w-3" />
              Stopped: {data.stopReason?.replace(/_/g, ' ').toLowerCase()}
            </Badge>
          )}
        </div>

        <ol className="space-y-3">
          {data.steps.map((step) => (
            <li key={step.stepId} className="flex gap-3 rounded-lg border border-border/50 px-3 py-2">
              <div className="mt-0.5">{stateIcon(step.state)}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{step.label}</p>
                <p className="truncate text-xs text-muted-foreground">{step.subjectTemplate}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {step.state === 'sent' && step.sentAt
                    ? `Sent ${formatWhen(step.sentAt)}`
                    : step.state === 'scheduled' && step.scheduledAt
                      ? `Scheduled ${formatWhen(step.scheduledAt)}`
                      : step.state === 'cancelled'
                        ? 'Cancelled'
                        : 'Pending'}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
