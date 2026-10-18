'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/dashboard/empty-state';
import { updateDeliverabilityAlert, type AlertStatus, type DeliverabilityAlert } from '@/lib/api';

const SEVERITY_ICON = {
  INFO: Info,
  WARNING: AlertTriangle,
  CRITICAL: AlertTriangle,
} as const;

const SEVERITY_VARIANT = {
  INFO: 'secondary',
  WARNING: 'warning',
  CRITICAL: 'destructive',
} as const;

export function AlertList({ alerts }: { alerts: DeliverabilityAlert[] }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: AlertStatus }) =>
      updateDeliverabilityAlert(id, status),
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.status === 'RESOLVED' ? 'Alert resolved' : 'Alert acknowledged',
      );
      await queryClient.invalidateQueries({ queryKey: ['deliverability', 'alerts'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="No alerts"
        description="Alerts appear when a measurable signal crosses one of your configured thresholds."
      />
    );
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => {
        const Icon = SEVERITY_ICON[alert.severity];
        return (
          <Card key={alert.id}>
            <CardContent className="flex items-start gap-3 p-4">
              <Icon
                className={
                  alert.severity === 'CRITICAL'
                    ? 'mt-0.5 h-5 w-5 shrink-0 text-destructive'
                    : 'mt-0.5 h-5 w-5 shrink-0 text-muted-foreground'
                }
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{alert.title}</span>
                  <Badge variant={SEVERITY_VARIANT[alert.severity]}>{alert.severity}</Badge>
                  {alert.status !== 'OPEN' && <Badge variant="outline">{alert.status}</Badge>}
                  {alert.entityLabel && (
                    <span className="text-xs text-muted-foreground">{alert.entityLabel}</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{alert.message}</p>
                {alert.recommendation && (
                  <p className="text-sm text-foreground">
                    <span className="font-medium">Recommended: </span>
                    {alert.recommendation}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {new Date(alert.occurredAt).toLocaleString()}
                </p>
              </div>
              {alert.status === 'OPEN' && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ id: alert.id, status: 'ACKNOWLEDGED' })}
                  >
                    Acknowledge
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={mutation.isPending}
                    onClick={() => mutation.mutate({ id: alert.id, status: 'RESOLVED' })}
                  >
                    Resolve
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
