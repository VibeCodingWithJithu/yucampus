import { Card, StatusPill } from '@yucampus/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { NAV } from '@/lib/nav';

// Placeholder for sidebar sections that are not built yet. Each real screen replaces it with its own
// folder (docs/ROADMAP.md), which takes priority over this dynamic route.
type Props = { params: Promise<{ section: string }> };

const findSection = (section: string) => NAV.find((item) => item.href === `/${section}`);

// Sections that already have their own screen.
const BUILT = new Set(['/dashboard', '/users', '/setup', '/evidence', '/review', '/naac']);

export function generateStaticParams() {
  return NAV.filter((item) => !BUILT.has(item.href)).map((item) => ({ section: item.href.slice(1) }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: findSection((await params).section)?.label };
}

export default async function SectionPlaceholderPage({ params }: Props) {
  const item = findSection((await params).section);
  if (!item) notFound();

  return (
    <>
      <PageHeader title={item.label} />
      <Card className="flex flex-col items-start gap-3">
        <StatusPill tone="neutral">Coming soon</StatusPill>
        <p className="max-w-prose text-secondary">This part of YuCampus is not ready yet.</p>
      </Card>
    </>
  );
}
