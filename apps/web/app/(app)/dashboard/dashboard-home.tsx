'use client';

import { useQuery } from '@tanstack/react-query';
import { type MyEvidence, type ReviewQueue, canOpenSection } from '@yucampus/types';
import { Card, buttonClasses, cn } from '@yucampus/ui';
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import { EvidenceStatus } from '@/components/evidence-status';
import { api } from '@/lib/api';
import { formatDateTime, plural } from '@/lib/format';

/**
 * What each person needs first: their uploads (faculty) and what waits for their approval (reviewers).
 * Under the college dashboard it has a heading and disappears for people with neither (e.g. the principal).
 */
export function DashboardHome({ heading, hideWhenEmpty = false }: { heading?: string; hideWhenEmpty?: boolean } = {}) {
  const { can, grants } = useAuth();
  const uploads = can('evidence.upload');
  const reviews = canOpenSection(grants, 'review');
  const mine = useQuery({
    queryKey: ['evidence', 'mine'],
    queryFn: () => api<MyEvidence>('/evidence/mine'),
    enabled: uploads,
  });
  const queue = useQuery({
    queryKey: ['review', 'queue'],
    queryFn: () => api<ReviewQueue>('/review/queue'),
    enabled: reviews,
  });

  if (hideWhenEmpty && !uploads && !reviews) return null;
  // Under a section heading, the cards' titles are one level lower.
  const CardHeading = heading ? 'h3' : 'h2';
  return (
    <section aria-label={heading} className="flex flex-col gap-3">
      {heading ? <h2 className="text-[17px] font-bold">{heading}</h2> : null}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {reviews ? (
          <Card className="flex flex-col gap-3">
            <CardHeading className="text-[17px] font-bold">Waiting for your approval</CardHeading>
            <p className="text-[34px] leading-none font-bold tabular-nums text-amber">{queue.data?.total ?? '–'}</p>
            <p className="text-sm text-secondary">
              {queue.data?.total
                ? `${plural(queue.data.total, 'upload')} to check, oldest first.`
                : 'Nothing is waiting for you right now.'}
            </p>
            {queue.data?.total ? (
              <div>
                <Link href="/review" className={buttonClasses()}>
                  Start reviewing
                </Link>
              </div>
            ) : null}
          </Card>
        ) : null}

        {uploads ? (
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardHeading className="text-[17px] font-bold">Your contribution</CardHeading>
              <Link href="/evidence/upload" className={buttonClasses()}>
                Upload evidence
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-card bg-bg p-3 text-center">
              {[
                { label: 'Uploaded', value: mine.data?.counts.uploaded, color: 'text-ink' },
                { label: 'Approved', value: mine.data?.counts.approved, color: 'text-teal' },
                { label: 'In review', value: mine.data?.counts.inReview, color: 'text-amber' },
              ].map((count) => (
                <div key={count.label} className="flex flex-col">
                  <span className={cn('text-[22px] font-bold tabular-nums', count.color)}>{count.value ?? '–'}</span>
                  <span className="text-xs text-muted">{count.label}</span>
                </div>
              ))}
            </div>
            {mine.data?.counts.needsFix ? (
              <Link
                href="/evidence/mine"
                className="rounded-control bg-red-soft px-3.5 py-2.5 text-sm font-semibold text-red-strong no-underline"
              >
                {plural(mine.data.counts.needsFix, 'upload needs', 'uploads need')} fixing →
              </Link>
            ) : null}
            <div>
              <h3 className="mb-1 text-sm font-bold">Recent uploads</h3>
              {mine.data?.items.length === 0 ? (
                <p className="text-sm text-secondary">Nothing yet. Your first upload takes less than a minute.</p>
              ) : null}
              <ul className="flex flex-col">
                {mine.data?.items.slice(0, 3).map((item) => (
                  <li key={item.id} className="border-b border-row last:border-b-0">
                    <Link
                      href={`/evidence/${item.id}`}
                      className="flex min-h-12 items-center justify-between gap-3 py-2 text-ink no-underline"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{item.title}</span>
                        <span className="text-xs text-muted">{formatDateTime(item.updatedAt)}</span>
                      </span>
                      <EvidenceStatus stage={item.stage} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        ) : null}

        {!uploads && !reviews ? (
          <Card>
            <CardHeading className="text-[17px] font-bold">Nothing to show yet</CardHeading>
            <p className="mt-1.5 max-w-prose text-secondary">
              Your readiness for NAAC, NBA and NIRF will appear here once your college starts adding evidence.
            </p>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
