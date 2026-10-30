'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import type { SessionResponse } from '@yucampus/types';
import { Button, Field, Notice, buttonClasses } from '@yucampus/ui';
import { passwordSchema } from '@yucampus/validation';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/components/auth-provider';
import { api, errorMessage } from '@/lib/api';

const formSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((values) => values.password === values.confirm, { path: ['confirm'], message: 'The two passwords are not the same' });

interface LinkInfo {
  purpose: 'invite' | 'reset';
  name: string;
  email: string | null;
}

export function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const link = useQuery({
    queryKey: ['password-link', token],
    queryFn: () => api<LinkInfo>(`/auth/password/link?token=${encodeURIComponent(token)}`, { auth: false }),
    enabled: token.length >= 20,
    retry: false,
  });
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(formSchema) });

  const submit = handleSubmit(async ({ password }) => {
    setError(null);
    try {
      signIn(await api<SessionResponse>('/auth/password/set', { method: 'POST', body: { token, password }, auth: false }));
      router.replace('/dashboard');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });

  if (token.length < 20 || link.isError) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="error">
          {link.isError ? errorMessage(link.error) : 'This link is not complete. Open it again from your email.'}
        </Notice>
        <Link href="/forgot-password" className={buttonClasses({ size: 'lg' })}>
          Get a new link
        </Link>
        <Link href="/login" className="flex min-h-11 items-center self-start text-sm font-semibold">
          Back to sign in
        </Link>
      </div>
    );
  }
  if (!link.data) return <p className="text-sm text-muted">Checking your link…</p>;

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
      <p className="text-[15px] text-muted">
        {link.data.purpose === 'invite' ? `Welcome, ${link.data.name}. ` : `Hello ${link.data.name}. `}
        Choose a password of at least 8 characters, with letters and a number or symbol.
      </p>
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" value={link.data.email ?? ''} readOnly hidden />
      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        autoFocus
        error={formState.errors.password?.message}
        {...register('password')}
      />
      <Field
        label="Type it again"
        type="password"
        autoComplete="new-password"
        error={formState.errors.confirm?.message}
        {...register('confirm')}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? 'Saving…' : 'Save and sign in'}
      </Button>
    </form>
  );
}
