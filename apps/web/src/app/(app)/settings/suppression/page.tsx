'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldBan, Plus, MoreHorizontal, Trash2 } from 'lucide-react';
import { createSuppression, deleteSuppression, fetchSuppressions } from '@/lib/api';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const reasonVariant: Record<string, 'default' | 'destructive' | 'warning' | 'secondary' | 'outline'> = {
  MANUAL: 'secondary',
  UNSUBSCRIBED: 'default',
  BOUNCED: 'destructive',
  SPAM_COMPLAINT: 'destructive',
  INVALID: 'warning',
  RISKY: 'warning',
};

function SuppressionSkeleton() {
  return (
    <Card className="border-border">
      <CardContent className="p-0">
        <div className="p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SuppressionPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: suppressions = [], isLoading } = useQuery({
    queryKey: ['suppressions'],
    queryFn: fetchSuppressions,
  });

  const createMutation = useMutation({
    mutationFn: createSuppression,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppressions'] });
      setDialogOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSuppression,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppressions'] }),
  });

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    createMutation.mutate({
      type: form.get('type') as 'EMAIL' | 'DOMAIN',
      value: form.get('value') as string,
      reason: (form.get('reason') as string) || 'MANUAL',
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppression"
        description="Manage email and domain suppression lists to protect your sender reputation."
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Add Suppression
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Suppression</DialogTitle>
                <DialogDescription>
                  Suppress an email address or domain from receiving outbound emails.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select name="type" defaultValue="EMAIL">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EMAIL">Email</SelectItem>
                      <SelectItem value="DOMAIN">Domain</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="value">Value</Label>
                  <Input name="value" placeholder="email@example.com or example.com" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reason">Reason</Label>
                  <Select name="reason" defaultValue="MANUAL">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MANUAL">Manual</SelectItem>
                      <SelectItem value="UNSUBSCRIBED">Unsubscribed</SelectItem>
                      <SelectItem value="BOUNCED">Bounced</SelectItem>
                      <SelectItem value="SPAM_COMPLAINT">Spam complaint</SelectItem>
                      <SelectItem value="INVALID">Invalid</SelectItem>
                      <SelectItem value="RISKY">Risky</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Adding...' : 'Add Suppression'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <SuppressionSkeleton />
      ) : suppressions.length === 0 ? (
        <EmptyState
          icon={ShieldBan}
          title="No suppressions yet"
          description="Add email addresses or domains to your suppression list to prevent outbound emails."
          action={{ label: 'Add Suppression', onClick: () => setDialogOpen(true) }}
        />
      ) : (
        <Card className="border-border">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Value</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppressions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.value}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{s.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={reasonVariant[s.reason] ?? 'secondary'} className="text-xs">
                        {s.reason}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.source}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => deleteMutation.mutate(s.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
