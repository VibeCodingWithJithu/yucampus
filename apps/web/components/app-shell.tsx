'use client';

import { Card } from '@yucampus/ui';
import { canOpenSection } from '@yucampus/types';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { NAV } from '@/lib/nav';
import { AppSidebar } from './app-sidebar';
import { BottomNav } from './bottom-nav';
import { useAuth } from './auth-provider';
import { PageHeader } from './page-header';

/** Wraps every signed-in screen: sends signed-out visitors to sign-in and hides sections a role may not open. */
export function AppShell({ children }: { children: ReactNode }) {
  const { status, user, roles, grants } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'signedOut') router.replace('/login');
  }, [status, router]);

  if (status !== 'signedIn') {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center bg-bg text-muted">
        Loading…
      </div>
    );
  }

  const current = NAV.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const allowed = !current || canOpenSection(grants, current.section);

  return (
    <div className="flex min-h-screen flex-col bg-bg lg:flex-row">
      <AppSidebar user={user} roles={roles} grants={grants} />
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 pb-28 sm:p-8 sm:pb-28 lg:pb-8">
        {allowed ? (
          children
        ) : (
          <>
            <PageHeader title={current.label} />
            <Card>
              <h2 className="text-[17px] font-bold">You do not have access to this page</h2>
              <p className="mt-1.5 max-w-prose text-secondary">
                Your role does not include {current.label}. Ask your college admin if you need it.
              </p>
            </Card>
          </>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
