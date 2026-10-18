import { ExternalLink } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ResearchProvenance } from '@/lib/api';
import { VerificationBadge } from './verification-badge';
import { formatConfidence, humanizeField, provenanceSourceLabel } from './research-status';

interface Props {
  entries: ResearchProvenance[] | null | undefined;
  emptyText?: string;
}

function formatValue(value: ResearchProvenance['value']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function formatRetrieved(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Field | Value | Verification | Source | Provider | Retrieved | Confidence — one row per researched field. */
export function ProvenanceList({ entries, emptyText = 'No provenance recorded.' }: Props) {
  if (!entries || entries.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Verification</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Retrieved</TableHead>
            <TableHead className="text-right">Confidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry, index) => (
            <TableRow key={`${entry.field}-${index}`}>
              <TableCell className="whitespace-nowrap text-xs font-medium">{humanizeField(entry.field)}</TableCell>
              <TableCell className="max-w-[260px] truncate text-xs" title={formatValue(entry.value)}>
                {formatValue(entry.value)}
              </TableCell>
              <TableCell>
                <VerificationBadge verification={entry.verification} />
              </TableCell>
              <TableCell className="text-xs">
                {entry.sourceUrl ? (
                  <a
                    href={entry.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {provenanceSourceLabel(entry.source)}
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="text-muted-foreground">{provenanceSourceLabel(entry.source)}</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{entry.provider ?? '—'}</TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {formatRetrieved(entry.retrievedAt)}
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">{formatConfidence(entry.confidence)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
