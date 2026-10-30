'use client';

import type { SessionResponse } from '@yucampus/types';
import { Notice, buttonClasses } from '@yucampus/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { useAuth } from '@/components/auth-provider';
import { api, errorMessage } from '@/lib/api';

/** The last step of Google / Microsoft sign-in: swaps the one-time code for a session on this college's address. */
export default function SsoFinishPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const code = new URLSearchParams(window.location.search).get('code') ?? '';
    // The code should not stay in the address bar or the history.
    window.history.replaceState(null, '', '/sso/finish');
    api<SessionResponse>('/auth/sso/finish', { method: 'POST', body: { code }, auth: false })
      .then((session) => {
        signIn(session);
        router.replace('/dashboard');
      })
      .catch((caught: unknown) => setError(errorMessage(caught)));
  }, [signIn, router]);

  return (
    <AuthLayout title="Signing you in">
      {error ? (
        <div className="flex flex-col gap-4">
          <Notice tone="error">{error}</Notice>
          <Link href="/login" className={buttonClasses({ size: 'lg' })}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <p role="status" className="text-sm text-muted">
          One moment…
        </p>
      )}
    </AuthLayout>
  );
}
