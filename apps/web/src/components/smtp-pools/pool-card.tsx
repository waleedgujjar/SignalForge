'use client';

import Link from 'next/link';
import { Server } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SmtpPool } from '@/lib/api';

const STRATEGY_LABEL: Record<string, string> = {
  ROUND_ROBIN: 'Round Robin',
  LEAST_UTILIZED: 'Least Used',
  HEALTH_AWARE: 'Health Aware',
  CAMPAIGN_SPECIFIC: 'Campaign Specific',
  CAPACITY_BASED: 'Capacity Based',
};

interface PoolCardProps {
  pool: SmtpPool;
}

export function PoolCard({ pool }: PoolCardProps) {
  const enabledMembers = pool.members.filter((m) => m.enabled).length;
  const capacityToday = pool.members.reduce((sum, m) => {
    if (!m.enabled) return sum;
    return sum + Math.max(0, m.mailbox.dailySendingLimit - m.mailbox.currentDailyUsage);
  }, 0);

  return (
    <Link href={`/smtp-pools/${pool.id}`} className="block">
      <Card className="transition-colors hover:border-primary/40">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="h-4 w-4 text-muted-foreground" />
            {pool.name}
          </CardTitle>
          {pool.enabled ? (
            <Badge variant="secondary">Enabled</Badge>
          ) : (
            <Badge variant="outline">Disabled</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {pool.description && (
            <p className="text-sm text-muted-foreground">{pool.description}</p>
          )}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Strategy</p>
              <p className="font-medium">{STRATEGY_LABEL[pool.strategy] ?? pool.strategy}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Accounts</p>
              <p className="font-medium">
                {enabledMembers} <span className="text-muted-foreground">/ {pool.members.length}</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Capacity today</p>
              <p className="font-medium">{capacityToday}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
