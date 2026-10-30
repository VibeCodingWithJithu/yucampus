'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { SessionResponse } from '@yucampus/types';
import { Button, Field, cn } from '@yucampus/ui';
import { passwordLoginSchema, requestOtpSchema, verifyOtpSchema } from '@yucampus/validation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useAuth } from '@/components/auth-provider';
import { api, errorMessage } from '@/lib/api';
import { SsoButtons } from './sso-buttons';

type Method = 'mobile' | 'email';

const METHODS: { id: Method; label: string }[] = [
  { id: 'mobile', label: 'Mobile OTP' },
  { id: 'email', label: 'Email and password' },
];

const RESEND_AFTER_SECONDS = 30;

export function SignInForm() {
  const [method, setMethod] = useState<Method>('mobile');
  const { status } = useAuth();
  const router = useRouter();

  // Already signed in (or just signed in): go straight to the app.
  useEffect(() => {
    if (status === 'signedIn') router.replace('/dashboard');
  }, [status, router]);

  return (
    <div className="flex flex-col gap-5">
      <div role="group" aria-label="Sign-in method" className="grid grid-cols-2 gap-1 rounded-[10px] bg-track p-1">
        {METHODS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={method === id}
            onClick={() => setMethod(id)}
            className={cn(
              'h-11 cursor-pointer rounded-control text-sm font-semibold',
              method === id ? 'bg-surface text-primary shadow-[0_1px_3px_rgba(18,23,51,0.12)]' : 'text-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {method === 'mobile' ? <MobileSignIn /> : <EmailSignIn />}
      <SsoButtons />
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-control bg-red-soft px-3.5 py-2.5 text-sm font-medium text-red-strong">
      {message}
    </p>
  );
}

function MobileSignIn() {
  // Once a code has been requested, this holds the (cleaned) number it was sent to.
  const [sentTo, setSentTo] = useState<string | null>(null);
  return sentTo ? (
    <OtpStep mobile={sentTo} onChangeNumber={() => setSentTo(null)} />
  ) : (
    <MobileStep onSent={setSentTo} />
  );
}

function MobileStep({ onSent }: { onSent: (mobile: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(requestOtpSchema) });

  const submit = handleSubmit(async ({ mobile }) => {
    setError(null);
    try {
      await api('/auth/otp/request', { method: 'POST', body: { mobile }, auth: false });
      onSent(mobile);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
      <Field
        label="Mobile number"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="98765 43210"
        prefix="+91"
        error={formState.errors.mobile?.message}
        {...register('mobile')}
      />
      <FormError message={error} />
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? 'Sending…' : 'Send OTP'}
      </Button>
    </form>
  );
}

function OtpStep({ mobile, onChangeNumber }: { mobile: string; onChangeNumber: () => void }) {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_AFTER_SECONDS);
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(verifyOtpSchema),
    defaultValues: { mobile, otp: '' },
  });

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const submit = handleSubmit(async (values) => {
    setError(null);
    setNotice(null);
    try {
      signIn(await api<SessionResponse>('/auth/otp/verify', { method: 'POST', body: values, auth: false }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });

  async function resend() {
    setError(null);
    setNotice(null);
    try {
      await api('/auth/otp/request', { method: 'POST', body: { mobile }, auth: false });
      setNotice('We sent a new code.');
      setWait(RESEND_AFTER_SECONDS);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
      <p className="text-sm text-secondary">
        If +91 {mobile} is registered with your college, we have sent it a 6-digit code.
        {process.env.NODE_ENV === 'development' ? ' (Local development: the code is printed in the API console.)' : ''}
      </p>
      <Field
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        error={formState.errors.otp?.message}
        {...register('otp')}
      />
      <FormError message={error} />
      {notice ? (
        <p role="status" className="text-sm text-teal-strong">
          {notice}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? 'Checking…' : 'Sign in'}
      </Button>
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={onChangeNumber}>
          Change number
        </Button>
        <Button variant="ghost" onClick={() => void resend()} disabled={wait > 0}>
          {wait > 0 ? `Send again in ${wait}s` : 'Send again'}
        </Button>
      </div>
    </form>
  );
}

function EmailSignIn() {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(passwordLoginSchema) });

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      signIn(await api<SessionResponse>('/auth/login', { method: 'POST', body: values, auth: false }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
      <Field
        label="College email"
        type="email"
        autoComplete="username"
        placeholder="name@college.edu.in"
        error={formState.errors.email?.message}
        {...register('email')}
      />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        error={formState.errors.password?.message}
        {...register('password')}
      />
      <FormError message={error} />
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
      <Link href="/forgot-password" className="flex min-h-11 items-center self-start text-sm font-semibold">
        Forgot password?
      </Link>
    </form>
  );
}
