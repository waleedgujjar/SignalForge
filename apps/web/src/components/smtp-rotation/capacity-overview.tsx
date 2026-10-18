'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { RotationStats } from '@/lib/api';

interface CapacityOverviewProps {
  stats?: RotationStats;
  isLoading: boolean;
}

export function CapacityOverview({ stats, isLoading }: CapacityOverviewProps) {
  if (isLoading) {
    return <Skeleton className="h-40" />;
  }
  if (!stats) return null;

  const usedPct = stats.totalCapacity === 0 ? 0 : Math.min(100, (stats.usedCapacity / stats.totalCapacity) * 100);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Workspace capacity today</CardDescription>
          <CardTitle className="text-2xl">
            {stats.remainingCapacity.toLocaleString()}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              of {stats.totalCapacity.toLocaleString()}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Progress value={100 - usedPct} />
          <p className="mt-2 text-xs text-muted-foreground">
            {stats.usedCapacity.toLocaleString()} sends used across all active mailboxes.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Active pools</CardDescription>
          <CardTitle className="text-2xl">{stats.pools.filter((p) => p.enabled).length}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {stats.pools.length} total pool(s) configured.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Allocations in last 24h</CardDescription>
          <CardTitle className="text-2xl">
            {stats.allocationsToday.reduce((sum, a) => sum + a.allocated, 0).toLocaleString()}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {stats.allocationsToday.reduce((sum, a) => sum + a.failures, 0).toLocaleString()} allocation failures.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
