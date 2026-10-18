'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { updateDeliverabilityPolicy, type DeliverabilityPolicyResponse } from '@/lib/api';

type ProtectionKey = keyof DeliverabilityPolicyResponse['protection'];
type ThresholdKey = keyof DeliverabilityPolicyResponse['thresholds'];

const PROTECTION_FIELDS: Array<{ key: ProtectionKey; label: string; description: string; locked?: boolean }> = [
  {
    key: 'pauseOnCriticalBounceRate',
    label: 'Pause sending on critical bounce rate',
    description: 'Automatically pause a mailbox when its bounce rate reaches the critical threshold.',
  },
  {
    key: 'reduceSendingOnCritical',
    label: 'Hold back sends while health is critical',
    description: 'Defer queued jobs for a mailbox whose health score is in the critical band.',
  },
  {
    key: 'blockRecipientsAtRisk',
    label: 'Hold back recipients with repeated soft bounces',
    description: 'Stop sending to a recipient once it crosses the soft bounce threshold.',
  },
  {
    key: 'pauseLeadOnHardBounce',
    label: 'Suppress recipients on hard bounce',
    description: 'A permanently rejected address is always suppressed. This rule cannot be disabled.',
    locked: true,
  },
  {
    key: 'stopOnUnsubscribed',
    label: 'Stop sending after an unsubscribe',
    description: 'An unsubscribe always stops further sending to that recipient.',
    locked: true,
  },
];

const THRESHOLD_FIELDS: Array<{ key: ThresholdKey; label: string; suffix: string; step?: string }> = [
  { key: 'warningBounceRatePercent', label: 'Bounce rate warning', suffix: '%', step: '0.1' },
  { key: 'criticalBounceRatePercent', label: 'Bounce rate critical', suffix: '%', step: '0.1' },
  { key: 'warningFailureRatePercent', label: 'Failure rate warning', suffix: '%', step: '0.1' },
  { key: 'criticalFailureRatePercent', label: 'Failure rate critical', suffix: '%', step: '0.1' },
  { key: 'warningUnsubscribeRatePercent', label: 'Unsubscribe rate warning', suffix: '%', step: '0.1' },
  { key: 'softBounceThreshold', label: 'Soft bounces before at risk', suffix: '' },
  { key: 'softBounceSuppressThreshold', label: 'Soft bounces before suppression', suffix: '' },
  { key: 'minimumVolumeForRates', label: 'Minimum sends before rate rules apply', suffix: '' },
];

export function ProtectionSettingsForm({ policy }: { policy: DeliverabilityPolicyResponse }) {
  const queryClient = useQueryClient();
  const [protection, setProtection] = useState(policy.protection);
  const [thresholds, setThresholds] = useState(policy.thresholds);

  const mutation = useMutation({
    mutationFn: () => updateDeliverabilityPolicy({ protection, thresholds }),
    onSuccess: async () => {
      toast.success('Protection settings saved');
      await queryClient.invalidateQueries({ queryKey: ['deliverability', 'policy'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Automatic protection</CardTitle>
          <CardDescription>
            These rules run server-side. Suppression from hard bounces and unsubscribes is always
            enforced and cannot be turned off.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {PROTECTION_FIELDS.map((field) => (
            <div key={field.key} className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor={field.key} className="text-sm">
                  {field.label}
                </Label>
                <p className="text-xs text-muted-foreground">{field.description}</p>
              </div>
              <Switch
                id={field.key}
                checked={field.locked ? true : protection[field.key]}
                disabled={field.locked}
                onCheckedChange={(checked) =>
                  setProtection((current) => ({ ...current, [field.key]: checked }))
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Thresholds</CardTitle>
          <CardDescription>
            Defaults are conservative. Rate rules only apply once a mailbox has sent enough for the
            numbers to be meaningful.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {THRESHOLD_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key} className="text-sm">
                {field.label}
                {field.suffix && <span className="text-muted-foreground"> ({field.suffix})</span>}
              </Label>
              <Input
                id={field.key}
                type="number"
                step={field.step ?? '1'}
                value={thresholds[field.key]}
                onChange={(event) =>
                  setThresholds((current) => ({
                    ...current,
                    [field.key]: Number(event.target.value),
                  }))
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Saving...' : 'Save settings'}
        </Button>
      </div>
    </div>
  );
}
