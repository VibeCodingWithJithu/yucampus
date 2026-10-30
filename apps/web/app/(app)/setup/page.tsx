import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { DepartmentsSection } from './departments-section';
import { FrameworksSection } from './frameworks-section';
import { ProfileSection } from './profile-section';
import { SetupSteps } from './setup-steps';
import { SsoSection } from './sso-section';

export const metadata: Metadata = { title: 'Institution setup' };

export default function SetupPage() {
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Institution setup' }]}
        title="Institution setup"
        description="Set this up once; every screen uses it."
      />
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <SetupSteps />
        <div className="flex min-w-0 flex-col gap-6">
          <ProfileSection />
          <DepartmentsSection />
          <FrameworksSection />
          <SsoSection />
        </div>
      </div>
    </>
  );
}
