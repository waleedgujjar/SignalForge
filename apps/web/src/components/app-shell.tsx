'use client';

import { useState } from 'react';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { AppHeader } from '@/components/layout/app-header';
import { CommandMenu, useCommandMenu } from '@/components/layout/command-menu';
import { Sheet, SheetContent } from '@/components/ui/sheet';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { open: commandOpen, setOpen: setCommandOpen } = useCommandMenu();

  return (
    <div className="flex h-screen overflow-hidden bg-[#F4F7FB]">
      {/* Desktop sidebar */}
      <div className="hidden shrink-0 md:flex">
        <AppSidebar />
      </div>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[272px] p-0">
          <AppSidebar />
        </SheetContent>
      </Sheet>

      {/* Main area */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(37,99,235,0.06),_transparent_50%)]" />
        <AppHeader
          onToggleSidebar={() => setMobileOpen(true)}
          onOpenCommand={() => setCommandOpen(true)}
        />
        <main className="relative flex-1 overflow-auto">
          <div className="mx-auto max-w-[1400px] p-6 lg:p-8">{children}</div>
        </main>
      </div>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
