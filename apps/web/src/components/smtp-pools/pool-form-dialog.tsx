'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  createSmtpPool,
  updateSmtpPool,
  type CreateSmtpPoolInput,
  type RotationStrategy,
  type SmtpPool,
} from '@/lib/api';

const STRATEGIES: { value: RotationStrategy; label: string; hint: string }[] = [
  { value: 'ROUND_ROBIN', label: 'Round Robin', hint: 'Rotate accounts evenly, one after another.' },
  { value: 'LEAST_UTILIZED', label: 'Least Used', hint: 'Pick the account furthest from its daily limit.' },
  { value: 'CAPACITY_BASED', label: 'Capacity Based', hint: 'Pick the account with the most remaining capacity today.' },
];

interface PoolFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pool?: SmtpPool;
}

export function PoolFormDialog({ open, onOpenChange, pool }: PoolFormDialogProps) {
  const isEdit = Boolean(pool);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [strategy, setStrategy] = useState<RotationStrategy>('ROUND_ROBIN');
  const [enabled, setEnabled] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setName(pool?.name ?? '');
      setDescription(pool?.description ?? '');
      setStrategy((pool?.strategy as RotationStrategy) ?? 'ROUND_ROBIN');
      setEnabled(pool?.enabled ?? true);
    }
  }, [open, pool]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: CreateSmtpPoolInput = {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        strategy,
        enabled,
      };
      if (isEdit && pool) {
        return updateSmtpPool(pool.id, payload);
      }
      return createSmtpPool(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-pools'] });
      toast.success(isEdit ? 'Pool updated' : 'Pool created');
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save pool');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit SMTP pool' : 'New SMTP pool'}</DialogTitle>
          <DialogDescription>
            Group mailboxes together and choose how sending jobs rotate through them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="pool-name">Name</Label>
            <Input
              id="pool-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cold outreach — Q1"
            />
          </div>

          <div>
            <Label htmlFor="pool-description">Description (optional)</Label>
            <Textarea
              id="pool-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this pool is used for"
            />
          </div>

          <div>
            <Label htmlFor="pool-strategy">Rotation strategy</Label>
            <Select value={strategy} onValueChange={(v) => setStrategy(v as RotationStrategy)}>
              <SelectTrigger id="pool-strategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGIES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    <div className="flex flex-col">
                      <span>{s.label}</span>
                      <span className="text-xs text-muted-foreground">{s.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="pool-enabled">Enabled</Label>
              <p className="text-xs text-muted-foreground">
                Disabled pools are skipped by the allocator.
              </p>
            </div>
            <Switch id="pool-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Saving...' : isEdit ? 'Save changes' : 'Create pool'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
