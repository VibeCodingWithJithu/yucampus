import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegistersScreen } from './registers-screen';

export const metadata: Metadata = { title: 'Data registers' };

export default function RegistersPage() {
  return (
    <Suspense>
      <RegistersScreen />
    </Suspense>
  );
}
