'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpDown } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/dashboard/empty-state';
import { HealthTierBadge, ProtectionBadge } from './health-tier-badge';
import type { MailboxHealthRow } from '@/lib/api';

type SortKey = 'healthScore' | 'bounceRate' | 'replyRate' | 'failureRate' | 'attempted';

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'healthScore', label: 'Health' },
  { key: 'attempted', label: 'Attempted' },
  { key: 'bounceRate', label: 'Bounce rate' },
  { key: 'failureRate', label: 'Failure rate' },
  { key: 'replyRate', label: 'Reply rate' },
];

function readSortValue(row: MailboxHealthRow, key: SortKey): number {
  if (key === 'healthScore') return row.healthScore;
  if (key === 'attempted') return row.counters.attempted;
  return row.rates[key];
}

export function MailboxHealthTable({ mailboxes }: { mailboxes: MailboxHealthRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('healthScore');
  const [ascending, setAscending] = useState(true);

  if (mailboxes.length === 0) {
    return (
      <EmptyState
        title="No mailboxes yet"
        description="Connect a mailbox to start tracking delivery health."
      />
    );
  }

  const sorted = [...mailboxes].sort((a, b) => {
    const delta = readSortValue(a, sortKey) - readSortValue(b, sortKey);
    return ascending ? delta : -delta;
  });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setAscending((value) => !value);
      return;
    }
    setSortKey(key);
    setAscending(key === 'healthScore');
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Mailbox</TableHead>
          {COLUMNS.map((column) => (
            <TableHead key={column.key}>
              <button
                type="button"
                onClick={() => toggleSort(column.key)}
                className="flex items-center gap-1 hover:text-foreground"
              >
                {column.label}
                <ArrowUpDown className="h-3 w-3" />
              </button>
            </TableHead>
          ))}
          <TableHead>Protection</TableHead>
          <TableHead className="text-right">Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow key={row.mailboxId}>
            <TableCell className="max-w-[220px] truncate font-medium">{row.emailAddress}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <span className="font-medium">{row.healthScore}</span>
                <HealthTierBadge tier={row.tier} />
              </div>
            </TableCell>
            <TableCell>{row.counters.attempted}</TableCell>
            <TableCell>{row.rates.bounceRate}%</TableCell>
            <TableCell>{row.rates.failureRate}%</TableCell>
            <TableCell>{row.rates.replyRate}%</TableCell>
            <TableCell>
              <ProtectionBadge level={row.protectionLevel} />
            </TableCell>
            <TableCell className="text-right">
              <Button asChild variant="ghost" size="sm">
                <Link href={`/deliverability/mailboxes/${row.mailboxId}`}>View</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
