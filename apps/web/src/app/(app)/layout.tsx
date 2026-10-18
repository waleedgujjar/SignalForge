'use client';



import { useAuth } from '@/components/auth-provider';

import { AppShell } from '@/components/app-shell';

import { Loader2 } from 'lucide-react';



export default function AppLayout({ children }: { children: React.ReactNode }) {

  const { isLoading, isAuthenticated } = useAuth();



  if (isLoading) {

    return (

      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F4F7FB]">

        <Loader2 className="h-8 w-8 animate-spin text-primary" />

        <p className="text-sm text-muted-foreground">Loading your workspace...</p>

      </div>

    );

  }



  if (!isAuthenticated) {

    return (

      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#F4F7FB]">

        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />

        <p className="text-sm text-muted-foreground">Redirecting...</p>

      </div>

    );

  }



  return <AppShell>{children}</AppShell>;

}


