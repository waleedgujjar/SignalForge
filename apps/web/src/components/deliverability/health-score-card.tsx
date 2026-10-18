'use client';

import { Info } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { HealthTierBadge } from './health-tier-badge';
import type { HealthScoreComponent, HealthTier } from '@/lib/api';

type HealthScoreCardProps = {
  score: number;
  tier: HealthTier;
  explanation: string;
  components: HealthScoreComponent[];
  disclaimer?: string;
};

export function HealthScoreCard({
  score,
  tier,
  explanation,
  components,
  disclaimer,
}: HealthScoreCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              Health score
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="How this score is calculated">
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{explanation}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
            <CardDescription>Weighted from measurable sending signals</CardDescription>
          </div>
          <HealthTierBadge tier={tier} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <span className="text-4xl font-bold tracking-tight text-foreground">{score}</span>
          <span className="pb-1 text-sm text-muted-foreground">/ 100</span>
        </div>
        <Progress value={score} />

        <div className="space-y-2 pt-1">
          {components.map((component) => (
            <div key={component.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{component.label}</span>
                <span className="font-medium text-foreground">
                  {component.points.toFixed(1)} / {component.weight}
                </span>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">{component.detail}</p>
            </div>
          ))}
        </div>

        {disclaimer && (
          <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">
            {disclaimer}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
