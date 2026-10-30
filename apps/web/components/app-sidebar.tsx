'use client';

import { type Grant, ROLE_LABELS, type Role, type SessionUser, canOpenSection } from '@yucampus/types';
import { Button, Logo, cn } from '@yucampus/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { NAV } from '@/lib/nav';
import { useAuth } from './auth-provider';
import { UnreadBadge, useUnreadCount } from './unread-count';

const COLLEGE_TYPE_LABELS = {
  affiliated: 'Affiliated college',
  autonomous: 'Autonomous college',
  university: 'University',
} as const;

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="flex-none"
    >
      <path d={d} />
    </svg>
  );
}

/** Left sidebar on desktop; a top bar with a menu button on phones. Shows only what the person may open. */
export function AppSidebar({ user, roles, grants }: { user: SessionUser; roles: Role[]; grants: Grant[] }) {
  const pathname = usePathname();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const items = NAV.filter((item) => canOpenSection(grants, item.section));

  return (
    <aside className="flex flex-none flex-col border-b border-border bg-surface lg:min-h-screen lg:w-60 lg:border-r lg:border-b-0">
      <div className="flex items-center justify-between px-4 py-3 lg:px-6 lg:pt-6 lg:pb-0">
        <Logo />
        <button
          type="button"
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen((value) => !value)}
          className="flex h-11 cursor-pointer items-center gap-2 rounded-control border border-border px-3 text-sm font-semibold lg:hidden"
        >
          <Icon d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 6h16M4 12h16M4 18h16'} />
          Menu
        </button>
      </div>

      <div
        id="main-nav"
        className={cn('flex-1 flex-col gap-6 px-4 pt-2 pb-4 lg:flex lg:pt-7 lg:pb-6', open ? 'flex' : 'hidden')}
      >
        <nav aria-label="Main">
          <ul className="flex flex-col gap-0.5">
            {items.map(({ label, href, icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-control px-3 text-sm no-underline',
                      active ? 'bg-primary-soft font-semibold text-primary' : 'font-medium text-muted hover:bg-bg',
                    )}
                  >
                    <Icon d={icon} />
                    {label}
                    {href === '/notifications' ? <UnreadBadge count={unread} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 rounded-card bg-bg p-4">
            <span className="text-[13px] font-semibold">{user.college.name}</span>
            <span className="text-xs text-muted">{COLLEGE_TYPE_LABELS[user.college.type]}</span>
          </div>
          <div className="flex flex-col gap-1 px-1">
            <span className="text-[13px] font-semibold">{user.name}</span>
            <span className="text-xs text-muted">{roles.map((role) => ROLE_LABELS[role]).join(', ')}</span>
          </div>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </aside>
  );
}
