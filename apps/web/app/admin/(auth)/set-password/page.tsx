'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import type { PlatformChallenge, PlatformSession } from '@yucampus/types';
import { Button, Field, Notice } from '@yucampus/ui';
import { passwordSchema } from '@yucampus/validation';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AuthLayout } from '@/components/auth-layout';
import { errorMessage } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';
import { usePlatform } from '../../platform-provider';
import { MfaStep } from '../mfa-step';

const formSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((values) => values.password === values.confirm, { path: ['confirm'], message: 'The two passwords are not the same' });

function SetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const { signIn } = usePlatform();
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<PlatformChallenge | null>(null);
  const link = useQuery({
    queryKey: ['platform', 'link', token],
    queryFn: () => platformApi<{ purpose: 'invite' | 'reset'; name: string; email: string }>(`/auth/password/link?token=${encodeURIComponent(token)}`, { auth: false }),
    enabled: token.length >= 20,
    retry: false,
  });
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(formSchema) });

  const submit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      setChallenge(await platformApi<PlatformChallenge>('/auth/password/set', { method: 'POST', body: { token, password }, auth: false }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });

  if (challenge) {
    return (
      <MfaStep
        challenge={challenge}
        onSignedIn={(session: PlatformSession) => {
          signIn(session);
          router.replace('/admin');
        }}
        onRestart={() => router.replace('/admin/login')}
      />
    );
  }
  if (token.length < 20 || link.isError) {
    return <Notice tone="error">{link.isError ? errorMessage(link.error) : 'This link is not complete. Open it again from your email.'}</Notice>;
  }
  if (!link.data) return <p className="text-sm text-muted">Checking your link…</p>;
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
      <p className="text-[15px] text-muted">
        {link.data.purpose === 'invite' ? `Welcome to the team, ${link.data.name}. ` : `Hello ${link.data.name}. `}
        Choose a password of at least 8 characters, with letters and a number or symbol.
      </p>
      <input type="email" name="username" autoComplete="username" value={link.data.email} readOnly hidden />
      <Field label="New password" type="password" autoComplete="new-password" autoFocus error={formState.errors.password?.message} {...register('password')} />
      <Field label="Type it again" type="password" autoComplete="new-password" error={formState.errors.confirm?.message} {...register('confirm')} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? 'Saving…' : 'Save and continue'}
      </Button>
    </form>
  );
}

export default function PlatformSetPasswordPage() {
  return (
    <AuthLayout title="Choose your password" description="YuCampus team panel">
      <Suspense fallback={<p className="text-sm text-muted">Checking your link…</p>}>
        <SetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
