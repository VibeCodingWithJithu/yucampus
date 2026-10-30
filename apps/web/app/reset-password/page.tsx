import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Choose a password' };

export default function ResetPasswordPage() {
  return (
    <AuthLayout title="Choose a password">
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
