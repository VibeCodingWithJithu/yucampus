import type { Metadata } from 'next';
import { AuthLayout } from '@/components/auth-layout';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <AuthLayout title="Sign in" description="Use the email or mobile number your college registered.">
      <SignInForm />
    </AuthLayout>
  );
}
