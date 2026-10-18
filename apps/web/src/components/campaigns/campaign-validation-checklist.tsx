'use client';

import { CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import type { CampaignValidationResult } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CampaignValidationChecklist({ validation }: { validation: CampaignValidationResult | null }) {
  if (!validation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pre-launch checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Run validation to see launch readiness.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pre-launch checklist</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {validation.checks.map((check) => {
          const Icon = check.passed
            ? CheckCircle2
            : check.severity === 'warning'
              ? AlertTriangle
              : AlertCircle;
          const color = check.passed
            ? 'text-emerald-600'
            : check.severity === 'warning'
              ? 'text-amber-600'
              : 'text-destructive';

          return (
            <div key={check.id} className="flex items-start gap-2">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
              <div>
                <p className="text-sm font-medium">{check.label}</p>
                {check.message && <p className="text-xs text-muted-foreground">{check.message}</p>}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
