'use client';

import { Fragment } from 'react';
import { usePathname } from 'next/navigation';
import { PanelLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { NotificationBell } from '@/components/notifications/notification-bell';

const routeLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  mailboxes: 'Mailboxes',
  campaigns: 'Campaigns',
  leads: 'Leads',
  tags: 'Tags',
  lists: 'Lists',
  import: 'Import',
  settings: 'Settings',
  profile: 'Profile',
  workspace: 'Workspace',
  preferences: 'Preferences',
  security: 'Security',
  suppression: 'Suppression',
  integrations: 'Integrations',
  drive: 'Google Drive',
  history: 'History',
  'website-intelligence': 'Website Intelligence',
  automations: 'Automations',
  executions: 'Executions',
  logs: 'Logs',
  analytics: 'Analytics',
  deliverability: 'Deliverability',
  inbox: 'Inbox',
};

type AppHeaderProps = {
  onToggleSidebar?: () => void;
  onOpenCommand?: () => void;
};

export function AppHeader({ onToggleSidebar, onOpenCommand }: AppHeaderProps) {
  const pathname = usePathname();

  const segments = pathname.split('/').filter(Boolean);
  const crumbs = segments.map((seg, i) => ({
    label: routeLabels[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1),
    href: '/' + segments.slice(0, i + 1).join('/'),
    isLast: i === segments.length - 1,
  }));

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-white/80 px-4 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70">
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground md:hidden"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="mr-1 h-5 md:hidden" />

      <Breadcrumb className="hidden sm:block">
        <BreadcrumbList>
          {crumbs.map((crumb, i) => (
            <Fragment key={crumb.href}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {crumb.isLast ? (
                  <BreadcrumbPage className="font-medium">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={crumb.href} className="text-muted-foreground hover:text-foreground">
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex-1" />

      <button
        type="button"
        onClick={onOpenCommand}
        className="hidden h-9 w-full max-w-sm items-center gap-2 rounded-xl border border-border/80 bg-muted/40 px-3 text-left text-sm text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 sm:flex"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1">Search anything...</span>
        <kbd className="pointer-events-none hidden rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground lg:inline">
          ⌘K
        </kbd>
      </button>

      <NotificationBell />

      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0 text-muted-foreground sm:hidden"
        onClick={onOpenCommand}
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
      </Button>
    </header>
  );
}
