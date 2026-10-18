'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { fetchNotifications, markNotificationRead } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unreadCount = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="relative h-8 w-8 p-0" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">No notifications yet</div>
        ) : (
          items.slice(0, 20).map((item) => (
            <DropdownMenuItem
              key={item.id}
              className={cn('flex flex-col items-start gap-1 py-2', !item.readAt && 'bg-accent/40')}
              onClick={() => {
                if (!item.readAt) markRead.mutate(item.id);
              }}
              asChild={Boolean(item.href)}
            >
              {item.href ? (
                <Link href={item.href}>
                  <span className="text-sm font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground line-clamp-2">{item.body}</span>
                </Link>
              ) : (
                <>
                  <span className="text-sm font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground line-clamp-2">{item.body}</span>
                </>
              )}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
