'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';

import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { PoolCard } from '@/components/smtp-pools/pool-card';
import { PoolFormDialog } from '@/components/smtp-pools/pool-form-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchSmtpPools } from '@/lib/api';

export default function SmtpPoolsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const query = useQuery({
    queryKey: ['smtp-pools'],
    queryFn: fetchSmtpPools,
  });

  return (
    <>
      <PageHeader
        title="SMTP Pools"
        description="Group mailboxes into pools with a shared rotation strategy. Campaigns can send through a whole pool instead of picking individual accounts."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New pool
          </Button>
        }
      />

      {query.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : query.data && query.data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {query.data.map((pool) => (
            <PoolCard key={pool.id} pool={pool} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No SMTP pools yet"
          description="Create your first pool to group mailboxes and unlock rotation strategies."
          action={{ label: 'Create pool', onClick: () => setDialogOpen(true) }}
        />
      )}

      <PoolFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
