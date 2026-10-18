'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Mail,
  Megaphone,
  Users,
  ShieldBan,
  Plus,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';

const pages = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Campaigns', href: '/campaigns', icon: Megaphone },
  { label: 'Leads', href: '/leads', icon: Users },
  { label: 'Mailboxes', href: '/mailboxes', icon: Mail },
  { label: 'Suppression', href: '/settings/suppression', icon: ShieldBan },
];

type CommandMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  const router = useRouter();

  const runCommand = useCallback(
    (command: () => void) => {
      onOpenChange(false);
      command();
    },
    [onOpenChange],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages and actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Pages">
          {pages.map((page) => (
            <CommandItem
              key={page.href}
              onSelect={() => runCommand(() => router.push(page.href))}
            >
              <page.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {page.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Quick Actions">
          <CommandItem
            onSelect={() => runCommand(() => router.push('/campaigns'))}
          >
            <Plus className="mr-2 h-4 w-4 text-muted-foreground" />
            Create Campaign
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push('/leads'))}
          >
            <Plus className="mr-2 h-4 w-4 text-muted-foreground" />
            Add Lead
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push('/mailboxes'))}
          >
            <Plus className="mr-2 h-4 w-4 text-muted-foreground" />
            Connect Mailbox
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandMenu() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return { open, setOpen };
}
