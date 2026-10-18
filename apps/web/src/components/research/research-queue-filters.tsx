import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RESEARCH_STATUS_LABELS } from './research-status';

export type ResearchQueueStatusFilter = 'ALL' | 'MANUAL_REVIEW' | 'PENDING' | 'FAILED' | 'UNAVAILABLE';

const STATUSES: ResearchQueueStatusFilter[] = ['ALL', 'MANUAL_REVIEW', 'PENDING', 'FAILED', 'UNAVAILABLE'];

interface Props {
  status: ResearchQueueStatusFilter;
  onStatusChange: (value: ResearchQueueStatusFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
}

function isStatusFilter(value: string): value is ResearchQueueStatusFilter {
  return (STATUSES as string[]).includes(value);
}

export function ResearchQueueFilters({ status, onStatusChange, search, onSearchChange }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-[220px] space-y-2">
        <Label htmlFor="research-queue-status" className="text-xs">
          Status
        </Label>
        <Select value={status} onValueChange={(v) => onStatusChange(isStatusFilter(v) ? v : 'ALL')}>
          <SelectTrigger id="research-queue-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'ALL' ? 'All attention items' : RESEARCH_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 space-y-2">
        <Label htmlFor="research-queue-search" className="text-xs">
          Search lead
        </Label>
        <Input
          id="research-queue-search"
          placeholder="Filter by email, name or company"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}
