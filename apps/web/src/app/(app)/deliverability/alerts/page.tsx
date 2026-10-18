'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';

import { PageHeader } from '@/components/dashboard/page-header';
import { AlertList } from '@/components/deliverability/alert-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchDeliverabilityAlerts, type AlertSeverity, type AlertStatus } from '@/lib/api';

const STATUS_OPTIONS: Array<{ value: AlertStatus | 'ALL'; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'ALL', label: 'All statuses' },
];

const SEVERITY_OPTIONS: Array<{ value: AlertSeverity | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All severities' },
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'INFO', label: 'Info' },
];

export default function DeliverabilityAlertsPage() {
  const [status, setStatus] = useState<AlertStatus | 'ALL'>('OPEN');
  const [severity, setSeverity] = useState<AlertSeverity | 'ALL'>('ALL');
  const [page, setPage] = useState(1);

  const alertsQuery = useQuery({
    queryKey: ['deliverability', 'alerts', { status, severity, page }],
    queryFn: () =>
      fetchDeliverabilityAlerts({
        status: status === 'ALL' ? undefined : status,
        severity: severity === 'ALL' ? undefined : severity,
        page,
        limit: 25,
      }),
  });

  const total = alertsQuery.data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/deliverability">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to deliverability
        </Link>
      </Button>

      <PageHeader
        title="Deliverability alerts"
        description="Each alert is raised once per signal per day, so repeated conditions do not flood this list."
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap gap-2">
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value as AlertStatus | 'ALL');
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={severity}
              onValueChange={(value) => {
                setSeverity(value as AlertSeverity | 'ALL');
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {alertsQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <AlertList alerts={alertsQuery.data?.alerts ?? []} />
          )}

          {total > 25 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages} — {total} alerts
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
