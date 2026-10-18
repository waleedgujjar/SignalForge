'use client';



import {

  createContext,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  type ReactNode,

} from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { usePathname, useRouter } from 'next/navigation';

import {

  fetchSession,

  logout as apiLogout,

  switchWorkspace as apiSwitchWorkspace,

  type SessionResponse,

  type MemberRole,

  type WorkspaceSummary,

} from '@/lib/api';

import { isAuthPath, isOnboardingPath, isProtectedPath, isPublicPath } from '@/lib/auth-routes';



interface AuthContextValue {

  session: SessionResponse | null;

  isLoading: boolean;

  isAuthenticated: boolean;

  user: SessionResponse['user'] | null;

  workspace: WorkspaceSummary | null | undefined;

  workspaces: WorkspaceSummary[];

  role: MemberRole | null | undefined;

  needsOnboarding: boolean;

  logout: () => Promise<void>;

  switchWorkspace: (workspaceId: string) => Promise<void>;

  refreshSession: () => Promise<void>;

}



const AuthContext = createContext<AuthContextValue | null>(null);



function resolveRedirect(pathname: string, session: SessionResponse | null): string | null {

  if (!session) {

    if (isProtectedPath(pathname) || isOnboardingPath(pathname)) {

      return '/login';

    }

    return null;

  }



  if (session.needsOnboarding) {

    if (!isOnboardingPath(pathname) && !isAuthPath(pathname)) {

      return '/onboarding';

    }

    return null;

  }



  if (isPublicPath(pathname) || isOnboardingPath(pathname) || isAuthPath(pathname)) {

    return '/dashboard';

  }



  return null;

}



export function AuthProvider({ children }: { children: ReactNode }) {

  const router = useRouter();

  const pathname = usePathname();

  const queryClient = useQueryClient();



  const {

    data: session,

    isLoading,

    refetch,

  } = useQuery({

    queryKey: ['session'],

    queryFn: fetchSession,

    retry: false,

    staleTime: 30_000,

  });



  const logoutMutation = useMutation({

    mutationFn: apiLogout,

    onSuccess: async () => {

      queryClient.setQueryData(['session'], null);

      await queryClient.invalidateQueries({ queryKey: ['session'] });

      router.push('/login');

    },

  });



  const switchMutation = useMutation({

    mutationFn: apiSwitchWorkspace,

    onSuccess: (data) => {

      queryClient.setQueryData(['session'], data);

      queryClient.invalidateQueries();

    },

  });



  useEffect(() => {

    if (isLoading) return;



    const target = resolveRedirect(pathname, session ?? null);

    if (!target || target === pathname) return;



    router.replace(target);



    const fallback = window.setTimeout(() => {

      if (window.location.pathname !== target) {

        window.location.assign(target);

      }

    }, 1500);



    return () => window.clearTimeout(fallback);

  }, [isLoading, session, pathname, router]);



  const logout = useCallback(async () => {

    await logoutMutation.mutateAsync();

  }, [logoutMutation]);



  const switchWorkspace = useCallback(

    async (workspaceId: string) => {

      await switchMutation.mutateAsync(workspaceId);

    },

    [switchMutation],

  );



  const refreshSession = useCallback(async () => {

    await refetch();

  }, [refetch]);



  const value = useMemo<AuthContextValue>(

    () => ({

      session: session ?? null,

      isLoading,

      isAuthenticated: Boolean(session && !session.needsOnboarding),

      user: session?.user ?? null,

      workspace: session?.workspace,

      workspaces: session?.workspaces ?? [],

      role: session?.role,

      needsOnboarding: session?.needsOnboarding ?? false,

      logout,

      switchWorkspace,

      refreshSession,

    }),

    [session, isLoading, logout, switchWorkspace, refreshSession],

  );



  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;

}



export function useAuth(): AuthContextValue {

  const context = useContext(AuthContext);

  if (!context) {

    throw new Error('useAuth must be used within AuthProvider');

  }

  return context;

}


