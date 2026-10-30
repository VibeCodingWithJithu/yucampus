'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Field, Notice, buttonClasses } from '@yucampus/ui';
import { forgotPasswordSchema } from '@yucampus/validation';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorMessage } from '@/lib/api';

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(forgotPasswordSchema) });

  const submit = handleSubmit(async ({ email }) => {
    setError(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', body: { email }, auth: false });
      setSentTo(email);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success">
          If {sentTo} belongs to an account at this college, a link is on its way. It works for 60 minutes.
        </Notice>
        <p className="text-sm text-muted">
          No email after a few minutes? Check your spam folder, or sign in with a code sent to your mobile number.
        </p>
        <Link href="/login" className={buttonClasses({ variant: 'secondary', size: 'lg' })}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
      <Field
        label="College email"
        type="email"
        autoComplete="username"
        placeholder="name@college.edu.in"
        autoFocus
        error={formState.errors.email?.message}
        {...register('email')}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? 'Sending…' : 'Email me a link'}
      </Button>
      <Link href="/login" className="flex min-h-11 items-center self-start text-sm font-semibold">
        Back to sign in
      </Link>
    </form>
  );
}
