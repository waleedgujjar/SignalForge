'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/dashboard/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  createWarmupRecipient,
  deleteWarmupRecipient,
  fetchWarmupRecipients,
  updateWarmupRecipient,
} from '@/lib/api';

export default function WarmupRecipientsPage() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);

  const recipients = useQuery({
    queryKey: ['warmup', 'recipients'],
    queryFn: fetchWarmupRecipients,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createWarmupRecipient({
        email: email.trim(),
        name: name.trim() || null,
        consentConfirmed: true,
      }),
    onSuccess: () => {
      toast.success('Recipient added');
      setEmail('');
      setName('');
      setConsent(false);
      queryClient.invalidateQueries({ queryKey: ['warmup', 'recipients'] });
      queryClient.invalidateQueries({ queryKey: ['warmup', 'stats'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      updateWarmupRecipient(input.id, { enabled: input.enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warmup', 'recipients'] });
      queryClient.invalidateQueries({ queryKey: ['warmup', 'stats'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteWarmupRecipient(id),
    onSuccess: () => {
      toast.success('Recipient removed');
      queryClient.invalidateQueries({ queryKey: ['warmup', 'recipients'] });
      queryClient.invalidateQueries({ queryKey: ['warmup', 'stats'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <PageHeader
        title="Warmup recipients"
        description="Warmup emails are only ever sent to addresses you explicitly authorize below. Do not add addresses without the recipient's real consent."
      />

      <Alert className="mt-4">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Consent is your responsibility</AlertTitle>
        <AlertDescription>
          Adding a recipient here attests that the person has agreed to receive warmup emails from
          this workspace. Warmup messages do not solicit engagement — they only establish sending
          history.
        </AlertDescription>
      </Alert>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Add recipient</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!consent) return;
                createMutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="partner@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name (optional)</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Casey Partner"
                />
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="consent"
                  checked={consent}
                  onCheckedChange={(v) => setConsent(v === true)}
                />
                <Label htmlFor="consent" className="text-sm text-muted-foreground">
                  I confirm this recipient has agreed to receive warmup emails from this workspace.
                </Label>
              </div>
              <Button
                type="submit"
                disabled={!email || !consent || createMutation.isPending}
                className="w-full"
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                Add recipient
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Authorized recipients</CardTitle>
          </CardHeader>
          <CardContent>
            {recipients.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : recipients.data && recipients.data.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.email}</TableCell>
                      <TableCell>{r.name ?? '—'}</TableCell>
                      <TableCell>
                        <Switch
                          checked={r.enabled}
                          onCheckedChange={(v) =>
                            toggleMutation.mutate({ id: r.id, enabled: v })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(r.id)}
                          aria-label={`Remove ${r.email}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No warmup recipients yet. Warmup jobs will stay deferred until you add authorized
                recipients.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
