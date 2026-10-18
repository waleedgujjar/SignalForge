import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { MetricTrend } from '@/lib/api';

type MetricCardProps = {
  label: string;
  value: string;
  hint?: string;
  trend?: MetricTrend;
  /** For rate metrics a rising number is bad; for volume metrics it is neutral. */
  higherIsBetter?: boolean;
};

export function DeliverabilityMetricCard({
  label,
  value,
  hint,
  trend,
  higherIsBetter = false,
}: MetricCardProps) {
  return (
    <Card className="border-border">
      <CardContent className="pt-6">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
        {trend ? <TrendIndicator trend={trend} higherIsBetter={higherIsBetter} /> : null}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function TrendIndicator({
  trend,
  higherIsBetter,
}: {
  trend: MetricTrend;
  higherIsBetter: boolean;
}) {
  if (trend.direction === 'UNCHANGED' || trend.delta === 0) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowRight className="h-3 w-3" />
        No change vs previous period
      </p>
    );
  }

  const rising = trend.delta > 0;
  const good = higherIsBetter ? rising : !rising;
  const Icon = rising ? ArrowUpRight : ArrowDownRight;

  return (
    <p
      className={cn(
        'mt-1 flex items-center gap-1 text-xs',
        good ? 'text-green-600' : 'text-destructive',
      )}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(trend.delta).toFixed(2)} vs previous period
    </p>
  );
}
