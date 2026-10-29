'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  Mail,
  Megaphone,
  Users,
  Settings,
  ChevronsUpDown,
  LogOut,
  UserCircle,
  Tag,
  ListChecks,
  Upload,
  Globe2,
  Radar,
  Send,
  Server,
  Shuffle,
  Flame,
  Inbox,
  ShieldCheck,
  Fingerprint,
  BarChart3,
  Workflow,
  Plus,
  Sparkles,
  SearchCheck,
  Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/auth-provider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type NavSection = {
  label: string;
  items: NavItem[];
};

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  disabled?: boolean;
};

const navigation: NavSection[] = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Outbound',
    items: [
      { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
      { href: '/automations', label: 'Automations', icon: Workflow },
    ],
  },
  {
    label: 'Replies',
    items: [{ href: '/inbox', label: 'Inbox', icon: Inbox }],
  },
  {
    label: 'Analytics',
    items: [
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/deliverability', label: 'Deliverability', icon: ShieldCheck },
      { href: '/deliverability/domains', label: 'Domain Auth', icon: Fingerprint },
    ],
  },
  {
    label: 'Leads',
    items: [
      { href: '/leads', label: 'Leads', icon: Users },
      { href: '/leads/verify', label: 'Verify Emails', icon: ShieldCheck },
      { href: '/leads/discovery', label: 'Discovery', icon: Radar },
      { href: '/leads/research', label: 'Research Queue', icon: SearchCheck },
      { href: '/leads/tags', label: 'Tags', icon: Tag },
      { href: '/leads/lists', label: 'Lists', icon: ListChecks },
      { href: '/leads/import', label: 'Import', icon: Upload },
      { href: '/large-leads', label: 'Large Lead Data', icon: Database },
      { href: '/website-intelligence', label: 'Website Intel', icon: Globe2 },
      { href: '/website-intelligence/studio', label: 'Analyze Website', icon: Globe2 },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { href: '/mailboxes', label: 'Mailboxes', icon: Mail },
      { href: '/smtp-pools', label: 'SMTP Pools', icon: Server },
      { href: '/smtp-rotation', label: 'SMTP Rotation', icon: Shuffle },
      { href: '/warmup', label: 'Email Warmup', icon: Flame },
      { href: '/sending', label: 'Sending Queue', icon: Send },
    ],
  },
  {
    label: 'System',
    items: [{ href: '/settings', label: 'Settings', icon: Settings }],
  },
];

function resolveActiveHref(pathname: string): string | null {
  let best: string | null = null;
  for (const section of navigation) {
    for (const item of section.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (!best || item.href.length > best.length)) {
        best = item.href;
      }
    }
  }
  return best;
}

function initials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
      : name.slice(0, 2).toUpperCase();
  }
  return (email ?? '??').slice(0, 2).toUpperCase();
}

type AppSidebarProps = {
  collapsed?: boolean;
};

export function AppSidebar({ collapsed }: AppSidebarProps) {
  const pathname = usePathname();
  const { user, workspace, workspaces, logout, switchWorkspace, refreshSession } = useAuth();
  const activeHref = resolveActiveHref(pathname);

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'relative flex h-full flex-col border-r border-sidebar-border/80 bg-sidebar',
          collapsed ? 'w-[72px]' : 'w-[272px]',
        )}
      >
        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,_rgba(37,99,235,0.18),_transparent_70%)]" />

        {/* Brand + workspace */}
        <div className="relative z-10 border-b border-sidebar-border/60 p-4">
          {!collapsed ? (
            <div className="space-y-4">
              <Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-600 shadow-lg shadow-primary/25">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-[15px] font-semibold tracking-tight text-white">
                    Signal<span className="text-primary">Forge</span>
                  </p>
                  <p className="text-[11px] text-sidebar-muted-foreground">Outbound Intelligence</p>
                </div>
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl border border-sidebar-border/80 bg-sidebar-accent/60 px-3 py-2.5 text-left transition-all hover:border-primary/30 hover:bg-sidebar-accent"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary">
                      {workspace?.name?.[0]?.toUpperCase() ?? 'S'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-sidebar-accent-foreground">
                        {workspace?.name ?? 'Workspace'}
                      </p>
                      <p className="truncate text-[11px] text-sidebar-muted-foreground">
                        {workspaces?.length ?? 0} workspace{(workspaces?.length ?? 0) === 1 ? '' : 's'}
                      </p>
                    </div>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-60" align="start" side="right" sideOffset={8}>
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Switch workspace
                  </DropdownMenuLabel>
                  {workspaces?.map((ws) => (
                    <DropdownMenuItem
                      key={ws.id}
                      onClick={() => {
                        switchWorkspace(ws.id);
                        refreshSession();
                      }}
                      className={cn('gap-2', ws.id === workspace?.id && 'bg-accent')}
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-[10px] font-bold text-primary">
                        {ws.name[0]?.toUpperCase()}
                      </div>
                      <span className="truncate">{ws.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button asChild size="sm" className="h-9 w-full gap-2 shadow-md shadow-primary/20">
                <Link href="/campaigns">
                  <Plus className="h-4 w-4" />
                  New campaign
                </Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Link
                href="/dashboard"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-blue-600 shadow-lg shadow-primary/25"
              >
                <Sparkles className="h-4 w-4 text-white" />
              </Link>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild size="icon" className="h-9 w-9">
                    <Link href="/campaigns">
                      <Plus className="h-4 w-4" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">New campaign</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Navigation */}
        <ScrollArea className="relative z-10 flex-1 px-3 py-2">
          <nav className="pb-4">
            {navigation.map((section, i) => (
              <div key={section.label} className={cn(i > 0 && 'mt-5')}>
                {!collapsed && (
                  <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted-foreground/90">
                    {section.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = item.href === activeHref;
                    const link = (
                      <Link
                        key={item.href}
                        href={item.disabled ? '#' : item.href}
                        className={cn(
                          'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-150',
                          active
                            ? 'bg-gradient-to-r from-primary/20 to-primary/5 text-white shadow-sm shadow-primary/10'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground',
                          collapsed && 'justify-center px-2',
                          item.disabled && 'pointer-events-none opacity-40',
                        )}
                        aria-current={active ? 'page' : undefined}
                      >
                        {active && (
                          <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary shadow-[0_0_8px_rgba(37,99,235,0.6)]" />
                        )}
                        <item.icon
                          className={cn(
                            'h-[18px] w-[18px] shrink-0 transition-colors',
                            active
                              ? 'text-primary'
                              : 'text-sidebar-muted-foreground group-hover:text-sidebar-accent-foreground',
                          )}
                        />
                        {!collapsed && (
                          <>
                            <span className="truncate">{item.label}</span>
                            {item.badge && (
                              <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                {item.badge}
                              </span>
                            )}
                          </>
                        )}
                      </Link>
                    );

                    if (collapsed) {
                      return (
                        <Tooltip key={item.href}>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      );
                    }

                    return link;
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>

        {/* User */}
        <div className="relative z-10 border-t border-sidebar-border/60 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition-all hover:border-sidebar-border/60 hover:bg-sidebar-accent/60',
                  collapsed && 'justify-center px-0',
                )}
              >
                <Avatar className="h-9 w-9 ring-2 ring-primary/20">
                  <AvatarFallback className="bg-gradient-to-br from-primary/30 to-primary/10 text-xs font-semibold text-primary">
                    {initials(user?.name, user?.email)}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-medium text-sidebar-accent-foreground">
                        {user?.name ?? 'User'}
                      </p>
                      <p className="truncate text-[11px] text-sidebar-muted-foreground">
                        {user?.email ?? ''}
                      </p>
                    </div>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-sidebar-muted-foreground" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="start" side="right" sideOffset={8}>
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{user?.name ?? 'User'}</span>
                  <span className="text-xs text-muted-foreground">{user?.email ?? ''}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link href="/settings/profile">
                    <UserCircle className="mr-2 h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => logout()}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </TooltipProvider>
  );
}
