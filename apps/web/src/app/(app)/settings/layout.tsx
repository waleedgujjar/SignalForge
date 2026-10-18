'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { User, Building2, SlidersHorizontal, Shield, Plug, Target, BookOpen, Microscope } from 'lucide-react';
import { cn } from '@/lib/utils';

const settingsNav = [
  { href: '/settings/profile', label: 'Profile', icon: User },
  { href: '/settings/workspace', label: 'Workspace', icon: Building2 },
  { href: '/settings/integrations', label: 'Integrations', icon: Plug },
  { href: '/settings/research', label: 'Research Providers', icon: Microscope },
  { href: '/settings/icp', label: 'ICP Profile', icon: Target },
  { href: '/settings/services', label: 'Service Catalog', icon: BookOpen },
  { href: '/settings/preferences', label: 'Preferences', icon: SlidersHorizontal },
  { href: '/settings/security', label: 'Security', icon: Shield },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account and workspace settings.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="flex gap-1 lg:w-52 lg:shrink-0 lg:flex-col">
          {settingsNav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
