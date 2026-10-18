'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  fetchMailboxes,
  fetchSmtpPools,
  updateCampaign,
  type Campaign,
  type CampaignSendingMode,
} from '@/lib/api';

interface CampaignSendingModePickerProps {
  campaign: Campaign;
}

const MODES: { value: CampaignSendingMode; label: string; hint: string }[] = [
  {
    value: 'MAILBOX_LIST',
    label: 'Mailbox list',
    hint: 'Rotate through mailboxes you tick below (existing behavior).',
  },
  {
    value: 'SMTP_POOL',
    label: 'SMTP pool',
    hint: 'Rotate through a saved pool. Add or remove accounts in the Pools page.',
  },
  {
    value: 'SINGLE_MAILBOX',
    label: 'Single mailbox',
    hint: 'Always send from one specific mailbox.',
  },
];

export function CampaignSendingModePicker({ campaign }: CampaignSendingModePickerProps) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<CampaignSendingMode>(campaign.sendingMode ?? 'MAILBOX_LIST');
  const [poolId, setPoolId] = useState<string>(campaign.smtpPoolId ?? '');
  const [singleMailboxId, setSingleMailboxId] = useState<string>(campaign.mailboxId ?? '');

  useEffect(() => {
    setMode(campaign.sendingMode ?? 'MAILBOX_LIST');
    setPoolId(campaign.smtpPoolId ?? '');
    setSingleMailboxId(campaign.mailboxId ?? '');
  }, [campaign.sendingMode, campaign.smtpPoolId, campaign.mailboxId]);

  const poolsQuery = useQuery({
    queryKey: ['smtp-pools'],
    queryFn: fetchSmtpPools,
    enabled: mode === 'SMTP_POOL',
  });

  const mailboxesQuery = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => fetchMailboxes(),
    enabled: mode === 'SINGLE_MAILBOX',
  });

  const mutation = useMutation({
    mutationFn: () =>
      updateCampaign(campaign.id, {
        sendingMode: mode,
        smtpPoolId: mode === 'SMTP_POOL' ? poolId || null : null,
        mailboxId: mode === 'SINGLE_MAILBOX' ? singleMailboxId || null : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', campaign.id] });
      toast.success('Sending mode saved');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to save'),
  });

  const canSave =
    mode === 'MAILBOX_LIST' ||
    (mode === 'SMTP_POOL' && Boolean(poolId)) ||
    (mode === 'SINGLE_MAILBOX' && Boolean(singleMailboxId));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sending mode</CardTitle>
        <CardDescription>
          Decide how this campaign selects a mailbox for each send.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="sending-mode">Mode</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as CampaignSendingMode)}>
            <SelectTrigger id="sending-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  <div className="flex flex-col">
                    <span>{m.label}</span>
                    <span className="text-xs text-muted-foreground">{m.hint}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {mode === 'SMTP_POOL' && (
          <div>
            <Label htmlFor="pool-select">SMTP pool</Label>
            <Select value={poolId} onValueChange={setPoolId}>
              <SelectTrigger id="pool-select">
                <SelectValue placeholder="Choose a pool" />
              </SelectTrigger>
              <SelectContent>
                {(poolsQuery.data ?? []).map((pool) => (
                  <SelectItem key={pool.id} value={pool.id}>
                    {pool.name} · {pool.members.length} account{pool.members.length === 1 ? '' : 's'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              The pool&apos;s own strategy overrides the campaign rotation strategy.
            </p>
          </div>
        )}

        {mode === 'SINGLE_MAILBOX' && (
          <div>
            <Label htmlFor="single-mailbox">Mailbox</Label>
            <Select value={singleMailboxId} onValueChange={setSingleMailboxId}>
              <SelectTrigger id="single-mailbox">
                <SelectValue placeholder="Choose a mailbox" />
              </SelectTrigger>
              <SelectContent>
                {(mailboxesQuery.data ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.emailAddress}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save mode
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
