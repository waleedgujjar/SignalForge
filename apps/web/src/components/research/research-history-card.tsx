'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ExternalLink, History } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fetchLeadResearchHistory, type ResearchHistoryItem, type ResearchHistorySource } from '@/lib/api';
import { ConfidenceBadge } from './confidence-badge';
import { ResearchStatusBadge } from './research-status-badge';
import { RESEARCH_QUERY_KEYS, RESEARCH_TYPE_LABELS } from './research-status';

const SOURCE_LABELS: Record<ResearchHistorySource, string> = {
  LINKEDIN: 'LinkedIn',
  WEBSITE: 'Website',
  EMAIL_VERIFICATION: 'Email verification',
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function StatusCell({ item }: { item: ResearchHistoryItem }) {
  if (item.source === 'LINKEDIN') return <ResearchStatusBadge status={item.status} />;
  return <Badge variant="outline">{item.status.replace(/_/g, ' ')}</Badge>;
}

/** Unified read-time timeline: LinkedIn research + website analyses + email verification checks. */
export function ResearchHistoryCard({ leadId }: { leadId: string }) {
  const historyQuery = useQuery({
    queryKey: RESEARCH_QUERY_KEYS.leadHistory(leadId),
    queryFn: () => fetchLeadResearchHistory(leadId),
    retry: false,
  });

  const items = historyQuery.data?.items ?? [];

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Research History
        </CardTitle>
        <CardDescription>
          Every research and verification run for this lead, newest first, with its source.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {historyQuery.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : historyQuery.isError ? (
          <p className="text-sm text-muted-foreground">Research history is unavailable right now.</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No research or verification runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead className="text-right">Links</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={`${item.source}-${item.id}`}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(item.date)}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{SOURCE_LABELS[item.source] ?? item.source}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.type ? RESEARCH_TYPE_LABELS[item.type] ?? item.type : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusCell item={item} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.provider ?? '—'}</TableCell>
                    <TableCell>
                      <ConfidenceBadge confidence={item.confidence} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-3 text-xs">
                        {item.sourceUrl && (
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            View source <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        )}
                        {item.href && (
                          <Link href={item.href} className="text-primary hover:underline">
                            Open
                          </Link>
                        )}
                        {!item.sourceUrl && !item.href && <span className="text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
