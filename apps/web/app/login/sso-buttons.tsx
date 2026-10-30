'use client';

import { useQuery } from '@tanstack/react-query';
import { SSO_PROVIDERS, SSO_PROVIDER_LABELS, type SsoOptions } from '@yucampus/types';
import { buttonClasses } from '@yucampus/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { collegeSubdomain } from '@/lib/tenant';

/** The one address Google and Microsoft sign-in runs on (auth.yubhiantechnologies.in in production; this site locally). */
const SSO_URL = process.env.NEXT_PUBLIC_SSO_URL ?? '';

const ERRORS: Record<string, string> = {
  sso_cancelled: 'Sign-in was cancelled. Try again, or use another way to sign in.',
  sso_failed: 'We could not finish that sign-in. Please try again.',
  sso_not_enabled: 'Your college has not turned on that way of signing in.',
  sso_domain: "That account's email is not on your college's domain. Sign in with your college account.",
  sso_unknown_user: 'There is no YuCampus account for that email at your college. Ask your college admin to add you.',
  college_suspended: 'YuCampus is paused for this college. Please contact your college admin or YuCampus support.',
};

/** "Continue with Google / Microsoft", when the college has turned them on. Also shows why an SSO sign-in failed. */
export function SsoButtons() {
  const options = useQuery({ queryKey: ['sso-options'], queryFn: () => api<SsoOptions>('/auth/sso/options', { auth: false }), retry: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('sso_error');
    if (code) setError(ERRORS[code] ?? ERRORS.sso_failed!);
  }, []);

  const shown = SSO_PROVIDERS.filter((p) => options.data?.[p]);
  return (
    <>
      {error ? (
        <p role="alert" className="rounded-control bg-red-soft px-3.5 py-2.5 text-sm font-medium text-red-strong">
          {error}
        </p>
      ) : null}
      {shown.length ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3 text-xs text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          {shown.map((provider) => (
            <a
              key={provider}
              href={`${SSO_URL}/api/v1/auth/sso/${provider}/start?college=${encodeURIComponent(collegeSubdomain())}`}
              className={buttonClasses({ variant: 'secondary', size: 'lg' })}
            >
              Continue with {SSO_PROVIDER_LABELS[provider]}
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}
