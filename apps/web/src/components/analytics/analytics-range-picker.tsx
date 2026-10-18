'use client';

import { useState } from 'react';
import { CalendarRange } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AnalyticsPeriod, AnalyticsQuery } from '@/lib/api';

const PRESETS: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

type AnalyticsRangePickerProps = {
  value: AnalyticsQuery;
  onChange: (value: AnalyticsQuery) => void;
};

/// Preset selector with a custom-range popover. A custom range is only applied
/// once both dates are set, so the caller never issues a half-specified query.
export function AnalyticsRangePicker({ value, onChange }: AnalyticsRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(value.startDate ?? '');
  const [endDate, setEndDate] = useState(value.endDate ?? '');

  const handlePreset = (period: AnalyticsPeriod) => {
    if (period === 'custom') {
      setOpen(true);
      return;
    }
    onChange({ ...value, period, startDate: undefined, endDate: undefined });
  };

  const applyCustom = () => {
    if (!startDate || !endDate) return;
    onChange({ ...value, period: 'custom', startDate, endDate });
    setOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={value.period} onValueChange={(next) => handlePreset(next as AnalyticsPeriod)}>
        <SelectTrigger className="w-[170px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Choose a custom date range">
            <CalendarRange className="h-4 w-4" />
            {value.period === 'custom' && value.startDate && value.endDate ? (
              <span className="ml-2 text-xs">
                {value.startDate} to {value.endDate}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="analytics-start-date">Start date</Label>
            <Input
              id="analytics-start-date"
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="analytics-end-date">End date</Label>
            <Input
              id="analytics-end-date"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">Ranges are capped at 366 days.</p>
          <Button size="sm" className="w-full" disabled={!startDate || !endDate} onClick={applyCustom}>
            Apply range
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
