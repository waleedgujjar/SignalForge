'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  fetchRotationSettings,
  updateRotationSettings,
  type DegradedMailboxPolicy,
  type RotationStrategy,
} from '@/lib/api';

const STRATEGIES: { value: RotationStrategy; label: string }[] = [
  { value: 'ROUND_ROBIN', label: 'Round Robin' },
  { value: 'LEAST_UTILIZED', label: 'Least Used' },
  { value: 'CAPACITY_BASED', label: 'Capacity Based' },
  { value: 'HEALTH_AWARE', label: 'Health Aware' },
];

const POLICIES: { value: DegradedMailboxPolicy; label: string; hint: string }[] = [
  { value: 'ALLOW', label: 'Allow', hint: 'Send through degraded mailboxes normally.' },
  {
    value: 'DEPRIORITIZE',
    label: 'Deprioritize',
    hint: 'Only pick degraded mailboxes when no healthy option remains.',
  },
  { value: 'EXCLUDE', label: 'Exclude', hint: 'Never allocate to degraded mailboxes.' },
];

export function RotationSettingsForm() {
  const query = useQuery({
    queryKey: ['rotation-settings'],
    queryFn: fetchRotationSettings,
  });
  const queryClient = useQueryClient();

  const [strategy, setStrategy] = useState<RotationStrategy>('ROUND_ROBIN');
  const [enabled, setEnabled] = useState(true);
  const [policy, setPolicy] = useState<DegradedMailboxPolicy>('ALLOW');

  useEffect(() => {
    if (query.data) {
      setStrategy(query.data.rotationStrategy);
      setEnabled(query.data.enabled);
      setPolicy(query.data.degradedMailboxPolicy);
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: () =>
      updateRotationSettings({
        rotationStrategy: strategy,
        enabled,
        degradedMailboxPolicy: policy,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rotation-settings'] });
      toast.success('Rotation settings saved');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Failed to save settings'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rotation defaults</CardTitle>
        <CardDescription>
          Workspace-wide defaults. Campaigns and pools can override the strategy per-send.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="rotation-enabled">Rotation enabled</Label>
                <p className="text-xs text-muted-foreground">
                  When off, campaigns fall back to their explicitly assigned mailboxes only.
                </p>
              </div>
              <Switch id="rotation-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div>
              <Label htmlFor="default-strategy">Default strategy</Label>
              <Select value={strategy} onValueChange={(v) => setStrategy(v as RotationStrategy)}>
                <SelectTrigger id="default-strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGIES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="degraded-policy">Degraded mailbox policy</Label>
              <Select value={policy} onValueChange={(v) => setPolicy(v as DegradedMailboxPolicy)}>
                <SelectTrigger id="degraded-policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLICIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <div className="flex flex-col">
                        <span>{p.label}</span>
                        <span className="text-xs text-muted-foreground">{p.hint}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving...' : 'Save settings'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
