'use client';

import { useQuery } from '@tanstack/react-query';
import type { CriterionView } from '@yucampus/types';
import { Card, Notice } from '@yucampus/ui';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { ReadinessBar, ReadinessPill, UnverifiedNotice } from '@/components/readiness';
import { api, errorMessage } from '@/lib/api';

export default function CriterionPage() {
  return (
    <Suspense>
      <Criterion />
    </Suspense>
  );
}

function Criterion() {
  const { number } = useParams<{ number: string }>();
  const frameworkId = useSearchParams().get('framework');
  const view = useQuery({
    queryKey: ['accreditation', 'criterion', frameworkId, number],
    queryFn: () => api<CriterionView>(`/frameworks/${frameworkId}/criteria/${number}`),
    enabled: Boolean(frameworkId),
  });
  const data = view.data;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'NAAC', href: '/naac' }, { label: `Criterion ${number}` }]}
        title={data ? `${data.number}. ${data.name}` : `Criterion ${number}`}
        description={data ? `${data.percent}% complete · ${data.metrics.length} metrics` : undefined}
      />
      {!frameworkId ? <Notice tone="error">Open this from the NAAC page.</Notice> : null}
      {view.isError ? <Notice tone="error">{errorMessage(view.error)}</Notice> : null}
      {view.isPending && frameworkId ? <p className="text-sm text-muted">Loading…</p> : null}
      {data && !data.framework.verified ? <UnverifiedNotice sourceTitle={data.framework.sourceTitle} /> : null}
      {data?.metrics.length === 0 ? <Card>Metrics for this criterion load from the official manual.</Card> : null}
      <ul className="flex flex-col gap-3">
        {data?.metrics.map((metric) => (
          <li key={metric.id}>
            <Link href={`/naac/metrics/${metric.id}`} className="block text-ink no-underline">
              <Card className="flex flex-col gap-3 hover:border-primary">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-[15px] font-bold">
                    <span className="text-muted">{metric.code}</span> {metric.name}
                  </h2>
                  <ReadinessPill status={metric.status} />
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <ReadinessBar percent={metric.percent} status={metric.status} label={`${metric.code} readiness`} />
                  </div>
                  <span className="w-12 text-right text-sm font-bold tabular-nums">{metric.percent}%</span>
                </div>
                <p className="text-[13px] text-secondary">
                  {metric.missing.length
                    ? `Missing: ${metric.missing.join(', ')}`
                    : 'Every required document has approved evidence.'}
                  {` · ${metric.evidenceCount} approved item${metric.evidenceCount === 1 ? '' : 's'}`}
                </p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
