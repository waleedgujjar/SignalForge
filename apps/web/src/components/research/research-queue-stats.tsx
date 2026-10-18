import { Card, CardContent } from '@/components/ui/card';
import type { ResearchStats } from '@/lib/api';

interface Props {
  stats?: ResearchStats;
  isLoading?: boolean;
}

type StatKey = 'manualReviewCount' | 'pendingCount' | 'verifiedCount' | 'completedLast7Days';

const CARDS: { label: string; key: StatKey; hint: string }[] = [
  { label: 'Manual review', key: 'manualReviewCount', hint: 'Stopped by a provider — needs a researcher' },
  { label: 'Suggested', key: 'pendingCount', hint: 'Awaiting your approval' },
  { label: 'Verified', key: 'verifiedCount', hint: 'Confirmed by a person' },
  { label: 'Completed (7 days)', key: 'completedLast7Days', hint: 'Finished research runs' },
];

export function ResearchQueueStats({ stats, isLoading }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CARDS.map((card) => (
        <Card key={card.key} className="border-border">
          <CardContent className="pt-6">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">
              {isLoading ? '—' : stats?.[card.key] ?? 0}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
