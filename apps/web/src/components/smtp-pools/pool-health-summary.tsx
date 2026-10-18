'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchSmtpPoolHealth } from '@/lib/api';

interface PoolHealthSummaryProps {
  poolId: string;
}

export function PoolHealthSummary({ poolId }: PoolHealthSummaryProps) {
  const query = useQuery({
    queryKey: ['smtp-pool-health', poolId],
    queryFn: () => fetchSmtpPoolHealth(poolId),
    refetchInterval: 30_000,
  });

  if (query.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (!query.data) return null;

  const stats = query.data;
  const cards: { label: string; value: number; hint?: string }[] = [
    { label: 'Enabled accounts', value: stats.enabledMembers, hint: `of ${stats.total} total` },
    { label: 'Healthy', value: stats.healthy },
    { label: 'Degraded', value: stats.degraded },
    { label: 'Capacity today', value: stats.capacityToday, hint: 'remaining sends' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold">{c.value}</p>
            {c.hint && <p className="text-xs text-muted-foreground">{c.hint}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
