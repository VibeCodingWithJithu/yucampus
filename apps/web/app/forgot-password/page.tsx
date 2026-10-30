import type { Metadata } from 'next';
import { AuthLayout } from '@/components/auth-layout';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <AuthLayout title="Forgot your password?" description="We will email you a link to choose a new one.">
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
