'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/dashboard/page-header';
import { PoolFormDialog } from '@/components/smtp-pools/pool-form-dialog';
import { PoolHealthSummary } from '@/components/smtp-pools/pool-health-summary';
import { PoolMemberPicker } from '@/components/smtp-pools/pool-member-picker';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  deleteSmtpPool,
  fetchSmtpPool,
  removeSmtpPoolMember,
  updateSmtpPoolMember,
} from '@/lib/api';

export default function SmtpPoolDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['smtp-pool', params.id],
    queryFn: () => fetchSmtpPool(params.id),
  });

  const toggleMember = useMutation({
    mutationFn: ({ mailboxId, enabled }: { mailboxId: string; enabled: boolean }) =>
      updateSmtpPoolMember(params.id, mailboxId, { enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-pool', params.id] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to update'),
  });

  const removeMember = useMutation({
    mutationFn: (mailboxId: string) => removeSmtpPoolMember(params.id, mailboxId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smtp-pool', params.id] });
      toast.success('Account removed');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to remove'),
  });

  const deletePool = useMutation({
    mutationFn: () => deleteSmtpPool(params.id),
    onSuccess: () => {
      toast.success('Pool deleted');
      router.push('/smtp-pools');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to delete'),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!query.data) {
    return <p className="text-sm text-muted-foreground">Pool not found.</p>;
  }
  const pool = query.data;

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push('/smtp-pools')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to pools
        </Button>
      </div>

      <PageHeader
        title={pool.name}
        description={pool.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            {pool.enabled ? (
              <Badge variant="secondary">Enabled</Badge>
            ) : (
              <Badge variant="outline">Disabled</Badge>
            )}
            <Badge variant="outline">{pool.strategy.replaceAll('_', ' ')}</Badge>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        }
      />

      <PoolHealthSummary poolId={pool.id} />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Accounts</h2>
              <p className="text-sm text-muted-foreground">
                Mailboxes in this pool. Toggle members off to skip them without removing.
              </p>
            </div>
            <PoolMemberPicker pool={pool} />
          </div>

          {pool.members.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No accounts yet. Add a mailbox to enable rotation.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mailbox</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Capacity today</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pool.members.map((member) => {
                  const remaining = Math.max(
                    0,
                    member.mailbox.dailySendingLimit - member.mailbox.currentDailyUsage,
                  );
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="font-medium">{member.mailbox.emailAddress}</div>
                        <div className="text-xs text-muted-foreground">{member.mailbox.fromName}</div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            member.mailbox.healthStatus === 'HEALTHY'
                              ? 'secondary'
                              : member.mailbox.healthStatus === 'UNHEALTHY'
                                ? 'destructive'
                                : 'outline'
                          }
                        >
                          {member.mailbox.healthStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {remaining} / {member.mailbox.dailySendingLimit}
                      </TableCell>
                      <TableCell>{member.priority}</TableCell>
                      <TableCell>
                        {member.enabled ? (
                          <Badge variant="secondary">Enabled</Badge>
                        ) : (
                          <Badge variant="outline">Disabled</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              toggleMember.mutate({
                                mailboxId: member.mailboxId,
                                enabled: !member.enabled,
                              })
                            }
                          >
                            {member.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => removeMember.mutate(member.mailboxId)}
                          >
                            Remove
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PoolFormDialog open={editOpen} onOpenChange={setEditOpen} pool={pool} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pool?</AlertDialogTitle>
            <AlertDialogDescription>
              Campaigns that reference this pool will fall back to their MAILBOX_LIST assignments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletePool.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete pool
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
