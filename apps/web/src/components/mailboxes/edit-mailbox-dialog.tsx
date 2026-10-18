'use client';

import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Mailbox, MailboxEncryption } from '@/lib/api';
import { updateMailbox } from '@/lib/api';

interface Props {
  mailbox: Mailbox | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

interface FormState {
  name: string;
  fromName: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  smtpPassword: string;
  encryptionType: MailboxEncryption;
  dailySendingLimit: string;
}

function toFormState(mailbox: Mailbox | null): FormState {
  return {
    name: mailbox?.name ?? '',
    fromName: mailbox?.fromName ?? '',
    replyTo: mailbox?.replyTo ?? '',
    smtpHost: mailbox?.smtpHost ?? '',
    smtpPort: mailbox?.smtpPort ? String(mailbox.smtpPort) : '',
    smtpUsername: mailbox?.smtpUsername ?? '',
    smtpPassword: '',
    encryptionType: mailbox?.encryptionType ?? 'TLS',
    dailySendingLimit: mailbox ? String(mailbox.dailySendingLimit) : '100',
  };
}

export function EditMailboxDialog({ mailbox, open, onOpenChange, onUpdated }: Props) {
  const [state, setState] = useState<FormState>(toFormState(mailbox));

  useEffect(() => {
    setState(toFormState(mailbox));
  }, [mailbox]);

  const mutation = useMutation({
    mutationFn: async (id: string) =>
      updateMailbox(id, {
        name: state.name.trim() || null,
        fromName: state.fromName.trim(),
        replyTo: state.replyTo.trim() || null,
        smtpHost: state.smtpHost.trim(),
        smtpPort: Number(state.smtpPort),
        smtpUsername: state.smtpUsername.trim() || null,
        encryptionType: state.encryptionType,
        dailySendingLimit: Number(state.dailySendingLimit || '100'),
        ...(state.smtpPassword ? { smtpPassword: state.smtpPassword } : {}),
      }),
    onSuccess: () => {
      toast.success('Account updated.');
      onUpdated();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update account.');
    },
  });

  if (!mailbox) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
          <DialogDescription>
            Update settings for <strong>{mailbox.emailAddress}</strong>. Leave the password blank to
            keep the existing credentials.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Display name</Label>
            <Input
              id="edit-name"
              value={state.name}
              onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-fromName">From name</Label>
            <Input
              id="edit-fromName"
              value={state.fromName}
              onChange={(e) => setState((s) => ({ ...s, fromName: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-replyTo">Reply-to</Label>
            <Input
              id="edit-replyTo"
              value={state.replyTo}
              onChange={(e) => setState((s) => ({ ...s, replyTo: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-smtpHost">SMTP host</Label>
            <Input
              id="edit-smtpHost"
              value={state.smtpHost}
              onChange={(e) => setState((s) => ({ ...s, smtpHost: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-smtpPort">SMTP port</Label>
            <Input
              id="edit-smtpPort"
              type="number"
              value={state.smtpPort}
              onChange={(e) => setState((s) => ({ ...s, smtpPort: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-smtpUsername">Username</Label>
            <Input
              id="edit-smtpUsername"
              value={state.smtpUsername}
              onChange={(e) => setState((s) => ({ ...s, smtpUsername: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-smtpPassword">New password (optional)</Label>
            <Input
              id="edit-smtpPassword"
              type="password"
              value={state.smtpPassword}
              onChange={(e) => setState((s) => ({ ...s, smtpPassword: e.target.value }))}
              placeholder="Leave blank to keep existing"
            />
          </div>
          <div className="space-y-2">
            <Label>Encryption</Label>
            <Select
              value={state.encryptionType}
              onValueChange={(value) =>
                setState((s) => ({ ...s, encryptionType: value as MailboxEncryption }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TLS">TLS (STARTTLS)</SelectItem>
                <SelectItem value="SSL">SSL</SelectItem>
                <SelectItem value="NONE">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="edit-dailySendingLimit">Daily send limit</Label>
            <Input
              id="edit-dailySendingLimit"
              type="number"
              value={state.dailySendingLimit}
              onChange={(e) => setState((s) => ({ ...s, dailySendingLimit: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate(mailbox.id)} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
