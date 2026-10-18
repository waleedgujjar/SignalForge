'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DeliverabilityPeriod } from '@/lib/api';

const OPTIONS: Array<{ value: DeliverabilityPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

type PeriodSelectProps = {
  value: DeliverabilityPeriod;
  onChange: (value: DeliverabilityPeriod) => void;
};

export function PeriodSelect({ value, onChange }: PeriodSelectProps) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as DeliverabilityPeriod)}>
      <SelectTrigger className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
