'use client';

import { canOpenSection } from '@yucampus/types';
import { cn } from '@yucampus/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth-provider';
import { useUnreadCount } from './unread-count';

const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  review: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM8 12l3 3 5-6',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  uploads: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  plus: 'M12 5v14M5 12h14',
};

function Icon({ d, className }: { d: string; className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

/** Phones only: the everyday actions within thumb reach, with Upload in the middle (FacultyMobile design). */
export function BottomNav() {
  const pathname = usePathname();
  const { can, grants } = useAuth();
  const unread = useUnreadCount();
  if (!can('evidence.upload')) return null;

  const second = canOpenSection(grants, 'review')
    ? { href: '/review', label: 'Review', icon: ICONS.review }
    : { href: '/tasks', label: 'Tasks', icon: ICONS.tasks };
  const items = [
    { href: '/dashboard', label: 'Home', icon: ICONS.home },
    second,
    null,
    { href: '/evidence/mine', label: 'Uploads', icon: ICONS.uploads },
    { href: '/notifications', label: 'Alerts', icon: ICONS.bell },
  ];

  return (
    <nav
      aria-label="Quick actions"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-5 items-end">
        {items.map((item) =>
          item ? (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold no-underline',
                  pathname === item.href ? 'text-primary' : 'text-muted',
                )}
              >
                <span className="relative">
                  <Icon d={item.icon} />
                  {item.href === '/notifications' && unread > 0 ? (
                    <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-red ring-2 ring-surface" />
                  ) : null}
                </span>
                {item.label}
                {item.href === '/notifications' && unread > 0 ? <span className="sr-only">, {unread} unread</span> : null}
              </Link>
            </li>
          ) : (
            <li key="upload" className="flex justify-center">
              <Link
                href="/evidence/upload"
                aria-label="Upload evidence"
                className="-mt-5 mb-2 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-[0_4px_12px_rgba(43,57,144,0.35)]"
              >
                <Icon d={ICONS.plus} />
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
