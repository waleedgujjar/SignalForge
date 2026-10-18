'use client';

import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MailboxStatus } from '@/lib/api';

const OPTIONS: { value: 'ALL' | MailboxStatus; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'UNVERIFIED', label: 'Unverified' },
  { value: 'DISABLED', label: 'Disabled' },
  { value: 'ERROR', label: 'Error' },
];

interface Props {
  status: 'ALL' | MailboxStatus;
  search: string;
  onStatusChange: (status: 'ALL' | MailboxStatus) => void;
  onSearchChange: (value: string) => void;
}

export function MailboxFilters({ status, search, onStatusChange, onSearchChange }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={status === option.value ? 'default' : 'outline'}
            onClick={() => onStatusChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <div className="relative w-full sm:w-72">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by email, name, or host"
          className="pl-9"
        />
      </div>
    </div>
  );
}
