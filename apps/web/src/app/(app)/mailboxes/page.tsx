'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { AddMailboxDialog } from '@/components/mailboxes/add-mailbox-dialog';
import { BulkMailboxToolbar } from '@/components/mailboxes/bulk-mailbox-toolbar';
import { DeleteMailboxDialog } from '@/components/mailboxes/delete-mailbox-dialog';
import { EditMailboxDialog } from '@/components/mailboxes/edit-mailbox-dialog';
import { MailboxCard } from '@/components/mailboxes/mailbox-card';
import { MailboxFilters } from '@/components/mailboxes/mailbox-filters';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { Mailbox, MailboxStatus } from '@/lib/api';
import {
  bulkMailboxAction,
  disableMailbox,
  enableMailbox,
  fetchMailboxes,
  testMailbox,
} from '@/lib/api';

function MailboxesLoading() {
  return (
    <div className="grid gap-3">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="border-border p-5">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="mt-3 h-4 w-40" />
          <Skeleton className="mt-6 h-2 w-full" />
        </Card>
      ))}
    </div>
  );
}

export default function MailboxesPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Mailbox | null>(null);
  const [deleting, setDeleting] = useState<Mailbox | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | MailboxStatus>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: mailboxes = [], isLoading } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: () => fetchMailboxes(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['mailboxes'] });
  };

  const filtered = useMemo(() => {
    return mailboxes.filter((m) => {
      if (statusFilter !== 'ALL' && m.status !== statusFilter) return false;
      if (search) {
        const term = search.toLowerCase();
        const haystack = [m.emailAddress, m.name ?? '', m.smtpHost ?? '', m.fromName]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [mailboxes, statusFilter, search]);

  const stats = useMemo(() => {
    const counts = {
      total: mailboxes.length,
      active: 0,
      unverified: 0,
      error: 0,
      disabled: 0,
    };
    for (const m of mailboxes) {
      if (m.status === 'ACTIVE') counts.active += 1;
      else if (m.status === 'UNVERIFIED') counts.unverified += 1;
      else if (m.status === 'ERROR' || m.status === 'DISCONNECTED') counts.error += 1;
      else if (m.status === 'DISABLED') counts.disabled += 1;
    }
    return counts;
  }, [mailboxes]);

  const testMutation = useMutation({
    mutationFn: (id: string) => testMailbox(id),
    onSuccess: (result) => {
      if (result.success) toast.success(result.message);
      else toast.error(result.message);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Test failed.'),
  });

  const enableMutation = useMutation({
    mutationFn: (id: string) => enableMailbox(id),
    onSuccess: () => {
      toast.success('Account enabled.');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Enable failed.'),
  });

  const disableMutation = useMutation({
    mutationFn: (id: string) => disableMailbox(id),
    onSuccess: () => {
      toast.success('Account disabled.');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Disable failed.'),
  });

  const bulkMutation = useMutation({
    mutationFn: bulkMailboxAction,
    onSuccess: (result) => {
      const parts: string[] = [];
      if (result.succeeded) parts.push(`${result.succeeded} succeeded`);
      if (result.failed) parts.push(`${result.failed} failed`);
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      toast.success(`Bulk update complete: ${parts.join(', ') || 'no changes'}.`);
      setSelected(new Set());
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Bulk update failed.'),
  });

  function toggleSelect(id: string, next: boolean) {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  function toggleAccount(id: string, target: Mailbox['status']) {
    if (target === 'DISABLED') disableMutation.mutate(id);
    else enableMutation.mutate(id);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Infrastructure"
        description="Manage the SMTP accounts your campaigns send from. Passwords are encrypted at rest."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add email account
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Total accounts</div>
          <div className="mt-1 text-2xl font-semibold">{stats.total}</div>
        </Card>
        <Card className="border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Active</div>
          <div className="mt-1 text-2xl font-semibold">{stats.active}</div>
        </Card>
        <Card className="border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Unverified</div>
          <div className="mt-1 text-2xl font-semibold">{stats.unverified}</div>
        </Card>
        <Card className="border-border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Errors</div>
          <div className="mt-1 text-2xl font-semibold">{stats.error}</div>
        </Card>
      </div>

      <MailboxFilters
        status={statusFilter}
        search={search}
        onStatusChange={setStatusFilter}
        onSearchChange={setSearch}
      />

      <BulkMailboxToolbar
        count={selected.size}
        disabled={bulkMutation.isPending}
        onEnable={() =>
          bulkMutation.mutate({ mailboxIds: [...selected], action: 'ENABLE' })
        }
        onDisable={() =>
          bulkMutation.mutate({ mailboxIds: [...selected], action: 'DISABLE' })
        }
        onClear={() => setSelected(new Set())}
      />

      {isLoading ? (
        <MailboxesLoading />
      ) : mailboxes.length === 0 ? (
        <Card className="border-border">
          <EmptyState
            icon={Mail}
            title="No email accounts yet"
            description="Connect your first SMTP account to start sending campaigns."
            action={{ label: 'Add email account', onClick: () => setAddOpen(true) }}
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-border">
          <EmptyState
            icon={Mail}
            title="No accounts match your filters"
            description="Try clearing the search or switching status filters."
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((mailbox) => (
            <MailboxCard
              key={mailbox.id}
              mailbox={mailbox}
              selected={selected.has(mailbox.id)}
              onSelect={toggleSelect}
              onTest={(id) => testMutation.mutate(id)}
              onToggle={toggleAccount}
              onEdit={(id) => {
                const found = mailboxes.find((m) => m.id === id) ?? null;
                setEditing(found);
              }}
              onDelete={(id) => {
                const found = mailboxes.find((m) => m.id === id) ?? null;
                setDeleting(found);
              }}
              disabled={testMutation.isPending}
            />
          ))}
        </div>
      )}

      <AddMailboxDialog open={addOpen} onOpenChange={setAddOpen} onCreated={invalidate} />
      <EditMailboxDialog
        mailbox={editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onUpdated={invalidate}
      />
      <DeleteMailboxDialog
        mailbox={deleting}
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        onDeleted={invalidate}
      />
    </div>
  );
}
