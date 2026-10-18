'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';

import { PageHeader } from '@/components/dashboard/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchMailboxTestHistory } from '@/lib/api';

const PAGE_SIZE = 20;

export default function MailboxHistoryPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['mailbox-history', id, page],
    queryFn: () => fetchMailboxTestHistory(id, { page, limit: PAGE_SIZE }),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connection test history"
        description="Chronological record of SMTP connection tests. Passwords are never included."
        actions={
          <Button asChild variant="ghost">
            <Link href={`/mailboxes/${id}`}>Back to account</Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="border-border p-6 text-sm text-muted-foreground">
          No test history yet. Run a connection test from the account menu.
        </Card>
      ) : (
        <Card className="divide-y divide-border border-border">
          {items.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-1 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={entry.status === 'SUCCESS' ? 'success' : 'destructive'}>
                    {entry.status}
                  </Badge>
                  {entry.errorCategory && (
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {entry.errorCategory.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
              <div className="text-sm text-foreground">{entry.summary}</div>
            </div>
          ))}
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
