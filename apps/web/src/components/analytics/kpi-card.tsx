import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { KpiCard as KpiCardData, RateValue } from '@/lib/api';

export const INSUFFICIENT_DATA = 'Insufficient data';

/// Renders a rate honestly: a withheld rate says why instead of showing 0%.
export function formatRate(rate: RateValue | null | undefined): string {
  if (!rate || !rate.sufficientData || rate.value === null) return INSUFFICIENT_DATA;
  return `${rate.value}%`;
}

export function rateHint(rate: RateValue | null | undefined): string | undefined {
  if (!rate) return undefined;
  if (!rate.sufficientData) {
    return `Needs more ${rate.denominatorLabel} (${rate.denominator} so far)`;
  }
  return `${rate.numerator} of ${rate.denominator} ${rate.denominatorLabel}`;
}

type AnalyticsKpiCardProps = {
  card: KpiCardData;
  /// Volume metrics read better with a rising arrow as good; rate metrics differ.
  higherIsBetter?: boolean;
};

export function AnalyticsKpiCard({ card, higherIsBetter = true }: AnalyticsKpiCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {card.label}
        </div>
        <div className="mt-2 text-3xl font-semibold tabular-nums">
          {card.value.toLocaleString()}
        </div>
        {card.trend ? <TrendLine delta={card.trend.delta} higherIsBetter={higherIsBetter} /> : null}
        {card.note ? <p className="mt-1 text-xs text-muted-foreground">{card.note}</p> : null}
      </CardContent>
    </Card>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
  hint?: string;
  delta?: number;
  higherIsBetter?: boolean;
};

export function AnalyticsMetricCard({
  label,
  value,
  hint,
  delta,
  higherIsBetter = true,
}: MetricCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            'mt-2 font-semibold tabular-nums',
            value === INSUFFICIENT_DATA ? 'text-base text-muted-foreground' : 'text-3xl',
          )}
        >
          {value}
        </div>
        {delta !== undefined ? <TrendLine delta={delta} higherIsBetter={higherIsBetter} /> : null}
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function TrendLine({ delta, higherIsBetter }: { delta: number; higherIsBetter: boolean }) {
  if (delta === 0) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowRight className="h-3 w-3" aria-hidden />
        No change vs previous period
      </p>
    );
  }

  const rising = delta > 0;
  const good = higherIsBetter ? rising : !rising;
  const Icon = rising ? ArrowUpRight : ArrowDownRight;

  return (
    <p className={cn('mt-1 flex items-center gap-1 text-xs', good ? 'text-green-600' : 'text-destructive')}>
      <Icon className="h-3 w-3" aria-hidden />
      {rising ? '+' : '-'}
      {Math.abs(delta).toLocaleString()} vs previous period
    </p>
  );
}
