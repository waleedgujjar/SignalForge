'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';

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
import { addSmtpPoolMember, fetchMailboxes, type SmtpPool } from '@/lib/api';

interface PoolMemberPickerProps {
  pool: SmtpPool;
}

export function PoolMemberPicker({ pool }: PoolMemberPickerProps) {
  const [open, setOpen] = useState(false);
  const [mailboxId, setMailboxId] = useState('');
  const [priority, setPriority] = useState(0);
  const queryClient = useQueryClient();

  const mailboxesQuery = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => fetchMailboxes(),
    enabled: open,
  });

  const memberMailboxIds = new Set(pool.members.map((m) => m.mailboxId));
  const availableMailboxes = (mailboxesQuery.data ?? []).filter((m) => !memberMailboxIds.has(m.id));

  const mutation = useMutation({
    mutationFn: async () => {
      return addSmtpPoolMember(pool.id, { mailboxId, priority, enabled: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-pool', pool.id] });
      queryClient.invalidateQueries({ queryKey: ['smtp-pools'] });
      toast.success('Account added to pool');
      setOpen(false);
      setMailboxId('');
      setPriority(0);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add account');
    },
  });

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="mr-2 h-4 w-4" />
        Add account
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add mailbox to pool</DialogTitle>
            <DialogDescription>
              Pick a workspace mailbox and set its priority within the pool. Higher priority accounts are preferred by the allocator.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="member-mailbox">Mailbox</Label>
              <Select value={mailboxId} onValueChange={setMailboxId}>
                <SelectTrigger id="member-mailbox">
                  <SelectValue placeholder="Choose a mailbox" />
                </SelectTrigger>
                <SelectContent>
                  {availableMailboxes.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No available mailboxes.
                    </div>
                  ) : (
                    availableMailboxes.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.emailAddress}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="member-priority">Priority</Label>
              <Input
                id="member-priority"
                type="number"
                min={0}
                max={1000}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) || 0)}
              />
              <p className="mt-1 text-xs text-muted-foreground">Higher priority accounts win ties across all strategies.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!mailboxId || mutation.isPending}
            >
              {mutation.isPending ? 'Adding...' : 'Add to pool'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
