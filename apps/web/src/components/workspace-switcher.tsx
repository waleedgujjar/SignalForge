'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { createWorkspace } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function WorkspaceSwitcher() {
  const { workspace, workspaces, switchWorkspace, refreshSession } = useAuth();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const created = await createWorkspace(newName.trim());
      await switchWorkspace(created.id);
      setNewName('');
      setCreating(false);
      await refreshSession();
    } finally {
      setLoading(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-full justify-between gap-2">
          <span className="truncate">{workspace?.name ?? 'Select workspace'}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((ws) => (
          <DropdownMenuItem
            key={ws.id}
            onClick={() => switchWorkspace(ws.id)}
            className="flex items-center justify-between"
          >
            <span className="truncate">{ws.name}</span>
            {workspace?.id === ws.id && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {creating ? (
          <div className="space-y-2 p-2">
            <Input
              placeholder="Workspace name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={handleCreate} disabled={loading}>
                Create
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <DropdownMenuItem onClick={() => setCreating(true)} className={cn('gap-2')}>
            <Plus className="h-4 w-4" />
            Create workspace
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
