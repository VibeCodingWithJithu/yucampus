'use client';

import { Logo, cn } from '@yucampus/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { usePlatform } from '../platform-provider';

const NAV = [
  { href: '/admin', label: 'Colleges' },
  { href: '/admin/rules', label: 'Rules' },
  { href: '/admin/team', label: 'Team' },
  { href: '/admin/activity', label: 'Activity' },
];

/** The team panel's frame: signed-out visitors go to the team sign-in. */
export default function PanelLayout({ children }: { children: ReactNode }) {
  const { status, admin, signOut } = usePlatform();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'signedOut') router.replace('/admin/login');
  }, [status, router]);

  if (status !== 'signedIn') {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center bg-bg text-muted">
        Loading…
      </div>
    );
  }

  const current = (href: string) => (href === '/admin' ? pathname === '/admin' || pathname.startsWith('/admin/colleges') : pathname.startsWith(href));
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">Team panel</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-secondary sm:inline">{admin.name}</span>
            <button type="button" onClick={() => void signOut()} className="min-h-11 cursor-pointer rounded-control border border-border px-4 text-sm font-semibold hover:bg-bg">
              Sign out
            </button>
          </div>
        </div>
        <nav aria-label="Team panel" className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 sm:px-8">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current(item.href) ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold whitespace-nowrap no-underline',
                current(item.href) ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-ink',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-1 flex-col gap-6 p-4 sm:p-8">{children}</main>
    </div>
  );
}
