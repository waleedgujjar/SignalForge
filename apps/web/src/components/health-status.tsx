'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function HealthStatus() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform Status</CardTitle>
        <CardDescription>Live health check from the SignalForge API.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">Checking API health...</p> : null}
        {isError ? (
          <p className="text-sm text-destructive">Unable to reach the API. Ensure services are running.</p>
        ) : null}
        {data ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium">Status:</span> {data.status}
            </p>
            <p>
              <span className="font-medium">Service:</span> {data.service}
            </p>
            <p>
              <span className="font-medium">Version:</span> {data.version ?? 'n/a'}
            </p>
          </div>
        ) : null}
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
          {isFetching ? 'Refreshing...' : 'Refresh status'}
        </Button>
      </CardContent>
    </Card>
  );
}
