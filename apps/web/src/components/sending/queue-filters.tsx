import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SendingJobStatus } from '@/lib/api';

export type StatusFilter = 'ALL' | SendingJobStatus;

interface Props {
  status: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
}

const STATUSES: StatusFilter[] = [
  'ALL',
  'PENDING',
  'SCHEDULED',
  'PROCESSING',
  'RETRYING',
  'SENT',
  'FAILED',
  'CANCELLED',
  'PAUSED',
];

export function QueueFilters({ status, onStatusChange, search, onSearchChange }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-[200px] space-y-2">
        <Label className="text-xs">Status</Label>
        <Select value={status} onValueChange={(v) => onStatusChange(v as StatusFilter)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 space-y-2">
        <Label className="text-xs">Search lead email</Label>
        <Input
          placeholder="Filter by lead email"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}
