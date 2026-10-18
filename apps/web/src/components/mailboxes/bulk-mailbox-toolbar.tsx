'use client';

import { Power, PowerOff } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface Props {
  count: number;
  onEnable: () => void;
  onDisable: () => void;
  onClear: () => void;
  disabled?: boolean;
}

export function BulkMailboxToolbar({ count, onEnable, onDisable, onClear, disabled }: Props) {
  if (count === 0) return null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-4 py-3">
      <div className="text-sm text-muted-foreground">
        {count} account{count === 1 ? '' : 's'} selected
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onEnable} disabled={disabled}>
          <Power className="mr-2 h-4 w-4" /> Enable
        </Button>
        <Button variant="outline" size="sm" onClick={onDisable} disabled={disabled}>
          <PowerOff className="mr-2 h-4 w-4" /> Disable
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
