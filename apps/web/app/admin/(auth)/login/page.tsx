'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { PlatformChallenge, PlatformSession } from '@yucampus/types';
import { Button, Field, Notice } from '@yucampus/ui';
import { passwordLoginSchema } from '@yucampus/validation';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthLayout } from '@/components/auth-layout';
import { errorMessage } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';
import { usePlatform } from '../../platform-provider';
import { MfaStep } from '../mfa-step';

export default function PlatformLoginPage() {
  const { status, signIn } = usePlatform();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<PlatformChallenge | null>(null);
  const { register, handleSubmit, formState, reset } = useForm({ resolver: zodResolver(passwordLoginSchema) });

  useEffect(() => {
    if (status === 'signedIn') router.replace('/admin');
  }, [status, router]);

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      setChallenge(await platformApi<PlatformChallenge>('/auth/login', { method: 'POST', body: values, auth: false }));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  });

  const signedIn = (session: PlatformSession) => {
    signIn(session);
    router.replace('/admin');
  };

  return (
    <AuthLayout
      title={challenge?.step === 'enroll' ? 'One more step' : 'YuCampus team sign-in'}
      description={challenge ? undefined : "For the YuCampus team only. College staff sign in at their college's address."}
    >
      {challenge ? (
        <MfaStep
          challenge={challenge}
          onSignedIn={signedIn}
          onRestart={() => {
            setChallenge(null);
            reset({ email: '', password: '' });
          }}
        />
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
          <Field label="Team email" type="email" autoComplete="username" autoFocus error={formState.errors.email?.message} {...register('email')} />
          <Field label="Password" type="password" autoComplete="current-password" error={formState.errors.password?.message} {...register('password')} />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" size="lg" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? 'Checking…' : 'Continue'}
          </Button>
          <p className="text-[13px] text-muted">Forgot your password or lost your phone? Ask another team member.</p>
        </form>
      )}
    </AuthLayout>
  );
}
