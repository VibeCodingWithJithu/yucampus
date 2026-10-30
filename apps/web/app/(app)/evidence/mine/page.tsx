'use client';

import { useQuery } from '@tanstack/react-query';
import type { MyEvidence } from '@yucampus/types';
import { Card, Notice, buttonClasses, cn } from '@yucampus/ui';
import Link from 'next/link';
import { EvidenceStatus } from '@/components/evidence-status';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

export default function MyUploadsPage() {
  const mine = useQuery({ queryKey: ['evidence', 'mine'], queryFn: () => api<MyEvidence>('/evidence/mine') });
  const counts = mine.data?.counts;

  return (
    <>
      <PageHeader
        title="My uploads"
        description="Everything you have sent, and where it is in approval."
        actions={
          <Link href="/evidence/upload" className={buttonClasses()}>
            Upload evidence
          </Link>
        }
      />
      <section aria-label="Your contribution" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Uploaded', value: counts?.uploaded, color: 'text-ink' },
          { label: 'Approved', value: counts?.approved, color: 'text-teal' },
          { label: 'In review', value: counts?.inReview, color: 'text-amber' },
          { label: 'Needs fix', value: counts?.needsFix, color: 'text-red' },
        ].map((count) => (
          <Card key={count.label} className="flex flex-col gap-1 p-4 sm:p-5">
            <span className="text-[13px] text-muted">{count.label}</span>
            <span className={cn('text-[26px] font-bold tabular-nums', count.color)}>{count.value ?? '–'}</span>
          </Card>
        ))}
      </section>

      <Card className="flex flex-col gap-2">
        <h2 className="text-[17px] font-bold">Recent uploads</h2>
        {mine.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
        {mine.isError ? <Notice tone="error">{errorMessage(mine.error)}</Notice> : null}
        {mine.data?.items.length === 0 ? (
          <p className="py-4 text-sm text-secondary">Nothing yet. Your first upload takes less than a minute.</p>
        ) : null}
        <ul className="flex flex-col">
          {mine.data?.items.map((item) => (
            <li key={item.id} className="border-b border-row last:border-b-0">
              <Link
                href={`/evidence/${item.id}`}
                className="flex min-h-14 items-center justify-between gap-3 py-3 text-ink no-underline hover:bg-bg"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{item.title}</span>
                  <span className="text-xs text-muted">
                    {formatDateTime(item.updatedAt)}
                    {item.version > 1 ? ` · version ${item.version}` : ''}
                  </span>
                </span>
                <EvidenceStatus stage={item.stage} />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
