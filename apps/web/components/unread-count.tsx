'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from './auth-provider';

/** Unread notifications, checked every minute and whenever the page is opened again. Shared by the sidebar and bottom bar. */
export function useUnreadCount(): number {
  const { status } = useAuth();
  const query = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api<{ unread: number }>('/notifications/unread-count'),
    enabled: status === 'signedIn',
    refetchInterval: 60_000,
  });
  return query.data?.unread ?? 0;
}

/** A small count shown next to "Notifications"; the visible number is repeated for screen readers in words. */
export function UnreadBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red px-1.5 text-[11px] leading-5 font-bold text-white">
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">, {count} unread</span>
    </span>
  );
}
