'use client';

import { Info } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRate, rateHint } from '@/components/analytics/kpi-card';
import type { FunnelResult } from '@/lib/api';

type FunnelChartProps = {
  funnel: FunnelResult;
};

/// Horizontal funnel. Bars are sized against the top stage, and every stage
/// exposes its definition so a surprising number can be traced to its source.
export function FunnelChart({ funnel }: FunnelChartProps) {
  const top = funnel.steps[0]?.count ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Lead funnel</CardTitle>
        <CardDescription>
          Follows the leads imported in this range as they progress. Recent ranges show smaller
          late-stage counts because those leads have not finished the journey yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {funnel.steps.map((step) => (
          <div key={step.stage} className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium">{step.label}</span>
                <Tooltip>
                  <TooltipTrigger aria-label={`How ${step.label} is measured`}>
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    {funnel.definitions[step.stage]}
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-baseline gap-3 text-sm tabular-nums">
                <span className="font-semibold">{step.count.toLocaleString()}</span>
                {step.conversionFromPrevious ? (
                  <span className="text-xs text-muted-foreground" title={rateHint(step.conversionFromPrevious)}>
                    {formatRate(step.conversionFromPrevious)} of previous
                  </span>
                ) : null}
              </div>
            </div>
            <Progress value={top > 0 ? Math.min(100, (step.count / top) * 100) : 0} />
            {step.dropOff > 0 ? (
              <p className="text-xs text-muted-foreground">
                {step.dropOff.toLocaleString()} did not reach this stage
              </p>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
