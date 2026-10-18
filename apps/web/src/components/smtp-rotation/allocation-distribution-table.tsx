'use client';

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
import type { RotationStats } from '@/lib/api';

interface AllocationDistributionTableProps {
  stats?: RotationStats;
  isLoading: boolean;
}

export function AllocationDistributionTable({ stats, isLoading }: AllocationDistributionTableProps) {
  if (isLoading) {
    return <Skeleton className="h-40" />;
  }
  if (!stats) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Pools</CardTitle>
          <CardDescription>Capacity and rotation strategy per pool.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.pools.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No pools yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pool</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Capacity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.pools.map((pool) => (
                  <TableRow key={pool.id}>
                    <TableCell>
                      <div className="font-medium">{pool.name}</div>
                      {!pool.enabled && (
                        <Badge variant="outline" className="mt-1">
                          Disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{pool.strategy.replaceAll('_', ' ')}</TableCell>
                    <TableCell>
                      {pool.enabledMemberCount} <span className="text-muted-foreground">/ {pool.memberCount}</span>
                    </TableCell>
                    <TableCell>{pool.capacityToday.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent allocations</CardTitle>
          <CardDescription>Per-mailbox allocation counts in the last 24 hours.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.allocationsToday.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No allocations recorded in the last 24 hours.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mailbox</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                  <TableHead className="text-right">Failures</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.allocationsToday
                  .sort((a, b) => b.allocated - a.allocated)
                  .slice(0, 10)
                  .map((row) => (
                    <TableRow key={row.mailboxId}>
                      <TableCell className="font-mono text-xs">{row.mailboxId}</TableCell>
                      <TableCell className="text-right">{row.allocated.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {row.failures.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
