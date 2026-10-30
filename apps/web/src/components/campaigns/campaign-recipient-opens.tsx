'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Loader2, MailOpen } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { fetchCampaignRecipients } from '@/lib/api';

interface Props {
  campaignId: string;
}

function formatWhen(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function CampaignRecipientOpens({ campaignId }: Props) {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['campaign', campaignId, 'recipients', page],
    queryFn: () => fetchCampaignRecipients(campaignId, { page, limit: 25 }),
    refetchInterval: 20_000,
  });

  const rows = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MailOpen className="h-4 w-4" /> Recipients &amp; opens
        </CardTitle>
        <CardDescription>
          Recorded opens per recipient. Open tracking is approximate — automated image loads can
          register opens, and clients that block images or use privacy relays may not.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead>First open</TableHead>
                <TableHead>Last open</TableHead>
                <TableHead className="text-right">Total opens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center">
                    <Loader2 className="inline h-5 w-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No recipients yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const tracking = row.tracking ?? {
                    sent: false,
                    opened: false,
                    totalOpens: 0,
                    firstOpenedAt: null,
                    lastOpenedAt: null,
                  };
                  return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.lead.email}</div>
                      {(row.lead.fullName || row.lead.company) && (
                        <div className="text-xs text-muted-foreground">
                          {[row.lead.fullName, row.lead.company].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={tracking.sent ? 'secondary' : 'outline'}>
                        {tracking.sent ? 'Sent' : row.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {tracking.opened ? (
                        <Badge variant="default">Opened</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">Not opened</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatWhen(tracking.firstOpenedAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatWhen(tracking.lastOpenedAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{tracking.totalOpens}</TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Page {data?.page ?? page} of {totalPages}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
