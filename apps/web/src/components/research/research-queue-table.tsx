'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ClipboardCheck, ExternalLink, Loader2, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { approveResearch, retryResearch, type ResearchQueueItem } from '@/lib/api';
import { ResearchStatusBadge } from './research-status-badge';
import { RESEARCH_TYPE_LABELS, invalidateResearchQueries } from './research-status';

interface Props {
  items: ResearchQueueItem[];
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onEnterData: (item: ResearchQueueItem) => void;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function OpenLinkedInLink({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <Button variant="ghost" size="sm" asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="mr-1 h-3 w-3" aria-hidden="true" /> Open LinkedIn
      </a>
    </Button>
  );
}

export function ResearchQueueTable({ items, selectedIds, onToggleSelect, onToggleAll, onEnterData }: Props) {
  const queryClient = useQueryClient();

  const approveMutation = useMutation({
    mutationFn: (item: ResearchQueueItem) => approveResearch({ researchIds: [item.id] }),
    onSuccess: (result, item) => {
      toast.success(result.queued > 0 ? 'Research queued' : 'Nothing to queue — record was already handled');
      invalidateResearchQueries(queryClient, item.leadId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retryMutation = useMutation({
    mutationFn: (item: ResearchQueueItem) => retryResearch(item.id),
    onSuccess: (_result, item) => {
      toast.success('Research re-queued');
      invalidateResearchQueries(queryClient, item.leadId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pendingItems = items.filter((item) => item.status === 'PENDING');
  const allPendingSelected = pendingItems.length > 0 && pendingItems.every((item) => selectedIds.has(item.id));
  const somePendingSelected = pendingItems.some((item) => selectedIds.has(item.id));

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="Select all suggested records on this page"
                checked={allPendingSelected ? true : somePendingSelected ? 'indeterminate' : false}
                disabled={pendingItems.length === 0}
                onCheckedChange={(v) => onToggleAll(v === true)}
              />
            </TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const reason = item.errorMessage ?? item.summary ?? '';
            const url = item.sourceUrl ?? item.normalizedUrl;
            const busy =
              (approveMutation.isPending && approveMutation.variables?.id === item.id) ||
              (retryMutation.isPending && retryMutation.variables?.id === item.id);
            return (
              <TableRow key={item.id}>
                <TableCell>
                  {item.status === 'PENDING' ? (
                    <Checkbox
                      aria-label={`Select research for ${item.lead?.email ?? item.leadId}`}
                      checked={selectedIds.has(item.id)}
                      onCheckedChange={(v) => onToggleSelect(item.id, v === true)}
                    />
                  ) : null}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{item.lead?.company ?? '—'}</div>
                  {item.lead?.industry && <div className="text-xs text-muted-foreground">{item.lead.industry}</div>}
                </TableCell>
                <TableCell>
                  <div className="text-sm">{item.lead?.fullName ?? item.lead?.email ?? item.leadId}</div>
                  {item.lead?.fullName && item.lead.email && (
                    <div className="text-xs text-muted-foreground">{item.lead.email}</div>
                  )}
                </TableCell>
                <TableCell className="text-sm">{RESEARCH_TYPE_LABELS[item.researchType] ?? item.researchType}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <ResearchStatusBadge status={item.status} />
                    {item.errorCode && (
                      <Badge variant="outline" className="text-xs">
                        {item.errorCode}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground" title={reason || undefined}>
                  {reason || '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{item.provider ?? '—'}</TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(item.createdAt)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {item.status === 'MANUAL_REVIEW' && (
                      <>
                        <OpenLinkedInLink url={url} />
                        <Button variant="ghost" size="sm" onClick={() => onEnterData(item)}>
                          <ClipboardCheck className="mr-1 h-3 w-3" /> Enter Data
                        </Button>
                      </>
                    )}
                    {item.status === 'PENDING' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => approveMutation.mutate(item)}
                      >
                        {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                        Approve
                      </Button>
                    )}
                    {(item.status === 'FAILED' || item.status === 'UNAVAILABLE') && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => retryMutation.mutate(item)}
                        >
                          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                          Retry
                        </Button>
                        <OpenLinkedInLink url={url} />
                      </>
                    )}
                    {(item.status === 'COMPLETED' || item.status === 'PARTIAL') && (
                      <Button variant="ghost" size="sm" onClick={() => onEnterData(item)}>
                        <ClipboardCheck className="mr-1 h-3 w-3" /> Enter Data
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/leads/${item.leadId}`}>Open lead</Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
