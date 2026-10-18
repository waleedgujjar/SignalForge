'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { CampaignSendingModePicker } from '@/components/campaigns/campaign-sending-mode-picker';
import { MailboxHealthBadge } from '@/components/mailboxes/mailbox-health-badge';
import { MailboxStatusBadge } from '@/components/mailboxes/mailbox-status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchCampaign, fetchMailboxes, updateCampaign } from '@/lib/api';

export default function CampaignMailboxesPage() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const queryClient = useQueryClient();

  const { data: campaign, isLoading: loadingCampaign } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => fetchCampaign(campaignId),
  });

  const { data: allMailboxes = [], isLoading: loadingMailboxes } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => fetchMailboxes(),
  });

  const currentAssignedIds = useMemo(
    () => (campaign?.mailboxes ?? []).map((m) => m.mailbox.id),
    [campaign],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelected(new Set(currentAssignedIds));
  }, [currentAssignedIds]);

  const mutation = useMutation({
    mutationFn: (mailboxIds: string[]) => updateCampaign(campaignId, { mailboxIds }),
    onSuccess: () => {
      toast.success('Sending accounts updated.');
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Update failed.'),
  });

  function toggle(id: string, next: boolean) {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  const dirty = useMemo(() => {
    if (selected.size !== currentAssignedIds.length) return true;
    for (const id of currentAssignedIds) {
      if (!selected.has(id)) return true;
    }
    return false;
  }, [selected, currentAssignedIds]);

  if (loadingCampaign || loadingMailboxes) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  const eligibleMailboxes = allMailboxes.filter((m) => m.eligibility?.eligible !== false);
  const ineligibleAssigned = allMailboxes.filter(
    (m) => currentAssignedIds.includes(m.id) && m.eligibility?.eligible === false,
  );

  if (allMailboxes.length === 0) {
    return (
      <Card className="border-border p-6 text-sm text-muted-foreground">
        No sending accounts yet.{' '}
        <Link className="text-primary hover:underline" href="/mailboxes">
          Add an email account
        </Link>{' '}
        to attach it to this campaign.
      </Card>
    );
  }

  const sendingMode = campaign?.sendingMode ?? 'MAILBOX_LIST';
  const mailboxListDisabled = sendingMode !== 'MAILBOX_LIST';

  return (
    <div className="space-y-6">
      {campaign && <CampaignSendingModePicker campaign={campaign} />}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Mailbox list</h2>
          <p className="text-sm text-muted-foreground">
            {mailboxListDisabled
              ? 'This campaign uses a different sending mode. The mailbox list below is inactive but kept for reference.'
              : 'Choose which email accounts this campaign rotates through. Only verified, healthy accounts can be attached.'}
          </p>
        </div>
        <Button
          onClick={() => mutation.mutate([...selected])}
          disabled={!dirty || mutation.isPending || mailboxListDisabled}
        >
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save changes
        </Button>
      </div>

      {ineligibleAssigned.length > 0 && (
        <div className="flex gap-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-900">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <div>
            {ineligibleAssigned.length} attached account
            {ineligibleAssigned.length === 1 ? ' is' : 's are'} no longer eligible. They remain
            attached until you save, but the campaign will skip them at send time.
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {allMailboxes.map((mailbox) => {
          const eligible = mailbox.eligibility?.eligible !== false;
          const isSelected = selected.has(mailbox.id);
          return (
            <Card key={mailbox.id} className="border-border p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <Checkbox
                  checked={isSelected}
                  disabled={!eligible && !isSelected}
                  onCheckedChange={(next) => toggle(mailbox.id, next === true)}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {mailbox.name ?? mailbox.emailAddress}
                    </span>
                    <MailboxStatusBadge status={mailbox.status} />
                    <MailboxHealthBadge status={mailbox.healthStatus} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {mailbox.emailAddress} · remaining today {mailbox.remainingToday}/
                    {mailbox.dailySendingLimit}
                  </div>
                  {mailbox.eligibility && !mailbox.eligibility.eligible && (
                    <div className="mt-1 text-xs text-yellow-800">
                      {mailbox.eligibility.message}
                    </div>
                  )}
                </div>
              </label>
            </Card>
          );
        })}
      </div>

      <div className="text-xs text-muted-foreground">
        {eligibleMailboxes.length} eligible account{eligibleMailboxes.length === 1 ? '' : 's'} of{' '}
        {allMailboxes.length}.
      </div>
    </div>
  );
}
