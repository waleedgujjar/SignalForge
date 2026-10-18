'use client';

import { useState } from 'react';
import { ArrowUpDown } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/dashboard/empty-state';
import { formatRate, rateHint } from '@/components/analytics/kpi-card';
import type { DimensionRow } from '@/lib/api';

type SortKey = 'leads' | 'contacted' | 'replies' | 'positiveReplies' | 'meetings';

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'leads', label: 'Leads' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'replies', label: 'Replies' },
  { key: 'positiveReplies', label: 'Positive' },
  { key: 'meetings', label: 'Meetings' },
];

type DimensionTableProps = {
  label: string;
  rows: DimensionRow[];
  emptyTitle?: string;
  emptyDescription?: string;
};

export function DimensionTable({
  label,
  rows,
  emptyTitle = 'No data yet',
  emptyDescription = 'Import leads and launch a campaign to start seeing a breakdown here.',
}: DimensionTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('leads');
  const [ascending, setAscending] = useState(false);

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const sorted = [...rows].sort((a, b) => {
    const delta = a[sortKey] - b[sortKey];
    return ascending ? delta : -delta;
  });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setAscending((value) => !value);
      return;
    }
    setSortKey(key);
    setAscending(false);
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{label}</TableHead>
          {COLUMNS.map((column) => (
            <TableHead key={column.key}>
              <button
                type="button"
                onClick={() => toggleSort(column.key)}
                className="flex items-center gap-1 hover:text-foreground"
              >
                {column.label}
                <ArrowUpDown className="h-3 w-3" aria-hidden />
              </button>
            </TableHead>
          ))}
          <TableHead>Reply rate</TableHead>
          <TableHead>Positive rate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="max-w-[240px] truncate font-medium">{row.label}</TableCell>
            <TableCell className="tabular-nums">{row.leads.toLocaleString()}</TableCell>
            <TableCell className="tabular-nums">{row.contacted.toLocaleString()}</TableCell>
            <TableCell className="tabular-nums">{row.replies.toLocaleString()}</TableCell>
            <TableCell className="tabular-nums">{row.positiveReplies.toLocaleString()}</TableCell>
            <TableCell className="tabular-nums">{row.meetings.toLocaleString()}</TableCell>
            <TableCell className="text-muted-foreground" title={rateHint(row.replyRate)}>
              {formatRate(row.replyRate)}
            </TableCell>
            <TableCell className="text-muted-foreground" title={rateHint(row.positiveReplyRate)}>
              {formatRate(row.positiveReplyRate)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
