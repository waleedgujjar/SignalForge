'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAuth } from '@/components/auth-provider';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { AnalyticsTabs } from '@/components/analytics/analytics-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  deleteLeadOutcome,
  fetchAnalyticsOutcomes,
  fetchLeads,
  recordLeadOutcome,
  type LeadOutcomeType,
} from '@/lib/api';

const OUTCOME_TYPES: Array<{ value: LeadOutcomeType; label: string }> = [
  { value: 'MEETING_BOOKED', label: 'Meeting booked' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'CONVERTED', label: 'Converted' },
];

export default function AnalyticsOutcomesPage() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = role === 'OWNER' || role === 'ADMIN';

  const [open, setOpen] = useState(false);
  const [leadId, setLeadId] = useState('');
  const [type, setType] = useState<LeadOutcomeType>('MEETING_BOOKED');
  const [occurredAt, setOccurredAt] = useState('');
  const [note, setNote] = useState('');

  const outcomesQuery = useQuery({
    queryKey: ['analytics', 'outcomes'],
    queryFn: () => fetchAnalyticsOutcomes({ limit: 50 }),
  });

  const leadsQuery = useQuery({
    queryKey: ['leads', 'outcome-picker'],
    queryFn: () => fetchLeads({ limit: '100' }),
    enabled: open,
  });

  const recordMutation = useMutation({
    mutationFn: () =>
      recordLeadOutcome({
        leadId,
        type,
        occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
        note: note || undefined,
      }),
    onSuccess: () => {
      toast.success('Outcome recorded');
      setOpen(false);
      setLeadId('');
      setNote('');
      setOccurredAt('');
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not record the outcome');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLeadOutcome(id),
    onSuccess: () => {
      toast.success('Outcome removed');
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not remove the outcome');
    },
  });

  const outcomes = outcomesQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outcomes"
        description="Meetings and conversions are recorded here so the funnel reflects real results rather than estimates."
        actions={
          isAdmin ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm">Record outcome</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Record an outcome</DialogTitle>
                  <DialogDescription>
                    Logged outcomes feed the meetings KPI and the last stage of the lead funnel.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="outcome-lead">Lead</Label>
                    <Select value={leadId} onValueChange={setLeadId}>
                      <SelectTrigger id="outcome-lead">
                        <SelectValue placeholder="Select a lead" />
                      </SelectTrigger>
                      <SelectContent>
                        {(leadsQuery.data?.data ?? []).map((lead) => (
                          <SelectItem key={lead.id} value={lead.id}>
                            {lead.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="outcome-type">Type</Label>
                    <Select
                      value={type}
                      onValueChange={(value) => setType(value as LeadOutcomeType)}
                    >
                      <SelectTrigger id="outcome-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OUTCOME_TYPES.map((entry) => (
                          <SelectItem key={entry.value} value={entry.value}>
                            {entry.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="outcome-date">Occurred at</Label>
                    <Input
                      id="outcome-date"
                      type="datetime-local"
                      value={occurredAt}
                      onChange={(event) => setOccurredAt(event.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="outcome-note">Note</Label>
                    <Input
                      id="outcome-note"
                      value={note}
                      placeholder="Optional context"
                      onChange={(event) => setNote(event.target.value)}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    disabled={!leadId || recordMutation.isPending}
                    onClick={() => recordMutation.mutate()}
                  >
                    {recordMutation.isPending ? 'Saving…' : 'Record outcome'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <AnalyticsTabs />

      {!isAdmin ? (
        <Alert>
          <AlertDescription>
            Only workspace admins can record or remove outcomes. You can still review the history
            below.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recorded outcomes</CardTitle>
          <CardDescription>
            Until a calendar integration exists, meetings come from manual or API entries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {outcomesQuery.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : outcomes.length === 0 ? (
            <EmptyState
              title="No outcomes recorded yet"
              description="Record a meeting once a lead books time with you, and the funnel will pick it up."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lead</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Occurred</TableHead>
                  <TableHead>Note</TableHead>
                  {isAdmin ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {outcomes.map((outcome) => (
                  <TableRow key={outcome.id}>
                    <TableCell className="max-w-[220px] truncate font-medium">
                      {outcome.lead?.email ?? 'Deleted lead'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {OUTCOME_TYPES.find((entry) => entry.value === outcome.type)?.label ??
                          outcome.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {outcome.campaign?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(outcome.occurredAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">
                      {outcome.note ?? '—'}
                    </TableCell>
                    {isAdmin ? (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(outcome.id)}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
