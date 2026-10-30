import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PlatformProvider } from './platform-provider';

export const metadata: Metadata = { title: { default: 'Team panel', template: '%s · YuCampus team' }, robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <PlatformProvider>{children}</PlatformProvider>;
}
