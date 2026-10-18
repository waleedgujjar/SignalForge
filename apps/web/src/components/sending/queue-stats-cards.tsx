import { Card, CardContent } from '@/components/ui/card';
import type { QueueStats } from '@/lib/api';

interface QueueStatsCardsProps {
  stats?: QueueStats;
  isLoading?: boolean;
}

const CARDS: { label: string; key: 'pending' | 'processing' | 'sent' | 'failed' }[] = [
  { label: 'Pending', key: 'pending' },
  { label: 'Processing', key: 'processing' },
  { label: 'Sent', key: 'sent' },
  { label: 'Failed', key: 'failed' },
];

export function QueueStatsCards({ stats, isLoading }: QueueStatsCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CARDS.map((card) => (
        <Card key={card.key} className="border-border">
          <CardContent className="pt-6">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {card.label}
            </div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">
              {isLoading ? '—' : stats?.[card.key] ?? 0}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
