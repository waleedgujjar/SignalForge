'use client';

import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
import type { Mailbox } from '@/lib/api';
import { deleteMailbox } from '@/lib/api';

interface Props {
  mailbox: Mailbox | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function DeleteMailboxDialog({ mailbox, open, onOpenChange, onDeleted }: Props) {
  const mutation = useMutation({
    mutationFn: (id: string) => deleteMailbox(id),
    onSuccess: () => {
      toast.success('Account deleted.');
      onDeleted();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete account.');
    },
  });

  if (!mailbox) return null;
  const activeCampaigns = mailbox.assignedCampaigns?.filter((c) =>
    ['ACTIVE', 'SCHEDULED', 'PAUSED'].includes(c.status),
  ) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            This permanently removes <strong>{mailbox.emailAddress}</strong> from your workspace.
            Historical activity is preserved, but the account can no longer send email.
          </DialogDescription>
        </DialogHeader>

        {activeCampaigns.length > 0 && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-900">
            This account is currently attached to {activeCampaigns.length} campaign
            {activeCampaigns.length === 1 ? '' : 's'} with status ACTIVE, SCHEDULED, or PAUSED.
            Deleting it will remove the assignment.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate(mailbox.id)}
            disabled={mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
