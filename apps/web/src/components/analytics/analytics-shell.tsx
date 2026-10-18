'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const TABS = [
  { href: '/analytics', label: 'Overview' },
  { href: '/analytics/campaigns', label: 'Campaigns' },
  { href: '/analytics/sequences', label: 'Sequences' },
  { href: '/analytics/replies', label: 'Replies' },
  { href: '/analytics/leads', label: 'Leads' },
  { href: '/analytics/audience', label: 'Audience' },
  { href: '/analytics/mailboxes', label: 'Mailboxes' },
  { href: '/analytics/warmup', label: 'Warmup' },
  { href: '/analytics/imports', label: 'Imports' },
  { href: '/analytics/discovery', label: 'Discovery' },
  { href: '/analytics/website-intelligence', label: 'Website' },
  { href: '/analytics/outcomes', label: 'Outcomes' },
];

/// Sub-navigation shared by every analytics view. Scrolls horizontally on
/// narrow screens rather than wrapping into an unpredictable number of rows.
export function AnalyticsTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Analytics sections" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 px-1">
        {TABS.map((tab) => {
          const active =
            tab.href === '/analytics' ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
