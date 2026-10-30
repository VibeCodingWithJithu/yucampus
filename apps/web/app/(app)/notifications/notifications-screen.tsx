'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EmailDigest,
  NotificationChannel,
  NotificationKind,
  NotificationPage,
  NotificationPreferences,
  NotificationView,
} from '@yucampus/types';
import { Button, Card, Notice, SelectField, cn } from '@yucampus/ui';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

type Filter = 'all' | 'unread' | 'deadlines' | 'tasks';

const KIND: Record<NotificationKind, { label: string; dot: string; action: string }> = {
  task_assigned: { label: 'Task', dot: 'bg-primary', action: 'Open task' },
  task_due: { label: 'Deadline', dot: 'bg-red', action: 'Open task' },
  task_overdue: { label: 'Deadline', dot: 'bg-red', action: 'Open task' },
  evidence_approved: { label: 'Review', dot: 'bg-teal', action: 'View' },
  evidence_needs_fix: { label: 'Review', dot: 'bg-teal', action: 'Fix' },
  evidence_rejected: { label: 'Review', dot: 'bg-teal', action: 'View' },
  review_waiting: { label: 'Review', dot: 'bg-teal', action: 'Review' },
  key_date: { label: 'Key date', dot: 'bg-amber-fill', action: 'View' },
};

const CHANNELS: { id: NotificationChannel; label: string }[] = [
  { id: 'in_app', label: 'In app' },
  { id: 'email', label: 'Email' },
  { id: 'whatsapp', label: 'WhatsApp' },
];

const DIGESTS: { id: EmailDigest; label: string }[] = [
  { id: 'instant', label: 'Send each message right away' },
  { id: '09', label: 'One summary at 9:00 AM' },
  { id: '17', label: 'One summary at 5:00 PM' },
];

/** "10 min ago", "Yesterday", or the date. */
function when(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} hour${minutes < 90 ? '' : 's'} ago`;
  if (minutes < 48 * 60) return 'Yesterday';
  return formatDateTime(iso);
}

export function NotificationsScreen() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');

  const list = useInfiniteQuery({
    queryKey: ['notifications', 'list', filter],
    queryFn: ({ pageParam }) => api<NotificationPage>(`/notifications?filter=${filter}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.reduce((n, page) => n + page.items.length, 0) < last.total ? pages.length + 1 : undefined),
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = list.data?.pages[0]?.unread ?? 0;

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api<{ unread: number }>('/notifications/read', { method: 'POST', body: { ids: ids ?? null } }),
    onSuccess: (result) => {
      queryClient.setQueryData(['notifications', 'unread'], result);
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'list'] });
    },
  });

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: `Unread (${unread})` },
    { id: 'tasks', label: 'Tasks' },
    { id: 'deadlines', label: 'Deadlines' },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Notifications' }]}
        title="Notifications"
        description="Everything that needs your attention, and how you want to be told."
        actions={
          <Button variant="secondary" disabled={unread === 0 || markRead.isPending} onClick={() => markRead.mutate(undefined)}>
            Mark all as read
          </Button>
        }
      />
      <div className="flex flex-wrap items-start gap-4">
        <Card aria-label="Notification list" className="flex min-w-0 flex-[2_1_520px] flex-col gap-3">
          <div role="group" aria-label="Filter notifications" className="flex flex-wrap gap-2">
            {filters.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
                className={cn(
                  'h-11 cursor-pointer rounded-full border px-4 text-[13px]',
                  filter === option.id
                    ? 'border-primary bg-primary font-semibold text-white'
                    : 'border-border bg-surface font-medium text-ink hover:bg-bg',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {list.isError ? <Notice tone="error">{errorMessage(list.error)}</Notice> : null}
          {list.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
          {list.data && items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              {filter === 'unread' ? 'You have read everything.' : 'Nothing here yet.'}
            </p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <NotificationRow key={item.id} item={item} onOpen={() => !item.read && markRead.mutate([item.id])} />
            ))}
          </ul>
          {list.hasNextPage ? (
            <Button variant="secondary" className="self-center" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {list.isFetchingNextPage ? 'Loading…' : 'Show older'}
            </Button>
          ) : null}
        </Card>
        <Preferences />
      </div>
    </>
  );
}

function NotificationRow({ item, onOpen }: { item: NotificationView; onOpen: () => void }) {
  const kind = KIND[item.kind] ?? KIND.task_assigned;
  return (
    <li className={cn('flex items-start gap-3 rounded-[10px] p-3.5', item.read ? 'bg-surface' : 'bg-primary-soft/60')}>
      <span aria-hidden="true" className={cn('mt-1.5 size-2.5 flex-none rounded-full', kind.dot)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-sm leading-[1.45] break-words', item.read ? 'font-normal' : 'font-semibold')}>
          {item.read ? null : <span className="sr-only">Unread: </span>}
          {item.text}
        </span>
        <span className="text-xs text-muted">
          {when(item.createdAt)} · {kind.label}
        </span>
      </div>
      {item.link ? (
        <Link href={item.link} onClick={onOpen} className="flex min-h-11 flex-none items-center text-[13px] font-semibold no-underline">
          {kind.action}
        </Link>
      ) : !item.read ? (
        <Button variant="ghost" onClick={onOpen}>
          Mark read
        </Button>
      ) : null}
    </li>
  );
}

function Preferences() {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => api<NotificationPreferences>('/notifications/preferences'),
  });
  const save = useMutation({
    mutationFn: (next: NotificationPreferences) =>
      api<NotificationPreferences>('/notifications/preferences', {
        method: 'PUT',
        body: { events: next.events.map(({ event, channels }) => ({ event, channels })), emailDigest: next.emailDigest },
      }),
    // Shown straight away; the server's answer replaces it.
    onMutate: (next) => queryClient.setQueryData(['notifications', 'preferences'], next),
    onSuccess: (saved) => queryClient.setQueryData(['notifications', 'preferences'], saved),
    onError: () => void queryClient.invalidateQueries({ queryKey: ['notifications', 'preferences'] }),
  });

  function toggle(event: string, channel: NotificationChannel) {
    if (!prefs.data) return;
    save.mutate({
      ...prefs.data,
      events: prefs.data.events.map((row) =>
        row.event !== event
          ? row
          : { ...row, channels: row.channels.includes(channel) ? row.channels.filter((c) => c !== channel) : [...row.channels, channel] },
      ),
    });
  }

  return (
    <Card aria-labelledby="pref-h" className="flex min-w-0 flex-[1_1_380px] flex-col gap-3.5">
      <h2 id="pref-h" className="text-[17px] font-bold">
        How to tell me
      </h2>
      {prefs.isError ? <Notice tone="error">{errorMessage(prefs.error)}</Notice> : null}
      {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
      {prefs.data ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-xs text-muted">
                  <th scope="col" className="border-b border-border px-1 py-2 text-left font-semibold">
                    Event
                  </th>
                  {CHANNELS.map((channel) => (
                    <th key={channel.id} scope="col" className="border-b border-border px-1 py-2 font-semibold">
                      {channel.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {prefs.data.events.map((row) => (
                  <tr key={row.event}>
                    <th scope="row" className="border-b border-row px-1 py-2 text-left font-semibold">
                      {row.label}
                    </th>
                    {CHANNELS.map((channel) => {
                      // In-app is the list itself, so it is always on; WhatsApp is not connected yet.
                      const fixed = channel.id !== 'email';
                      return (
                        <td key={channel.id} className="border-b border-row p-1 text-center">
                          <label className={cn('inline-flex size-11 items-center justify-center', fixed ? 'cursor-not-allowed' : 'cursor-pointer')}>
                            <input
                              type="checkbox"
                              className="size-5 accent-primary"
                              aria-label={`${row.label} by ${channel.label}${channel.id === 'whatsapp' ? ' (coming later)' : ''}`}
                              checked={row.channels.includes(channel.id)}
                              disabled={fixed}
                              onChange={() => toggle(row.event, channel.id)}
                            />
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">In-app notifications are always on. WhatsApp messages are coming later.</p>
          <SelectField
            label="Daily summary instead of many emails"
            value={prefs.data.emailDigest}
            onChange={(event) => save.mutate({ ...prefs.data!, emailDigest: event.target.value as EmailDigest })}
          >
            {DIGESTS.map((digest) => (
              <option key={digest.id} value={digest.id}>
                {digest.label}
              </option>
            ))}
          </SelectField>
          <p role="status" className="min-h-5 text-xs text-muted">
            {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved.' : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">Loading…</p>
      )}
    </Card>
  );
}
