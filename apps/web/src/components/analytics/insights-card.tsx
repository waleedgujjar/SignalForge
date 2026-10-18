import { AlertTriangle, CircleAlert, Lightbulb } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AnalyticsInsight } from '@/lib/api';

const ICONS = {
  INFO: Lightbulb,
  WARNING: CircleAlert,
  CRITICAL: AlertTriangle,
} as const;

const TONES = {
  INFO: 'text-muted-foreground',
  WARNING: 'text-amber-600',
  CRITICAL: 'text-destructive',
} as const;

export function InsightsCard({ insights }: { insights: AnalyticsInsight[] }) {
  if (insights.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Insights</CardTitle>
        <CardDescription>
          Rule-based observations from the metrics above. Rankings are withheld until there is
          enough volume to be meaningful.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {insights.map((insight) => {
          const Icon = ICONS[insight.severity];
          return (
            <div key={insight.id} className="flex gap-3">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONES[insight.severity]}`} aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-medium">{insight.title}</p>
                <p className="text-sm text-muted-foreground">{insight.detail}</p>
                {insight.recommendation ? (
                  <p className="text-xs text-muted-foreground">{insight.recommendation}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
