'use client';

import { useQuery } from '@tanstack/react-query';
import type { AccreditationOverview, CriterionReadiness } from '@yucampus/types';
import { Card, Notice, Table, Td, Th, buttonClasses, cn } from '@yucampus/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { PageHeader } from '@/components/page-header';
import { ReadinessBar, ReadinessPill, UnverifiedNotice } from '@/components/readiness';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatYearLabel } from '@/lib/format';

type Filter = 'all' | 'attention' | 'ok';

export default function NaacPage() {
  const { can } = useAuth();
  const [frameworkId, setFrameworkId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const overview = useQuery({
    queryKey: ['accreditation', 'NAAC', frameworkId],
    queryFn: () =>
      api<AccreditationOverview>(`/accreditation/NAAC/overview${frameworkId ? `?framework=${frameworkId}` : ''}`),
  });
  const data = overview.data;

  const loaded = data?.criteria.filter((c) => !c.pending) ?? [];
  const attention = loaded.filter((c) => c.status !== 'on_track');
  const shown =
    filter === 'attention'
      ? attention
      : filter === 'ok'
        ? loaded.filter((c) => c.status === 'on_track')
        : (data?.criteria ?? []);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'NAAC' }]}
        title="NAAC criteria"
        description={
          data
            ? `${data.academicYear ? `Academic year ${formatYearLabel(data.academicYear)}` : 'No current academic year'}${data.cycle ? ` · ${data.cycle.label}` : ''} · only finally approved evidence counts`
            : undefined
        }
        actions={
          can('evidence.upload') ? (
            <Link href="/evidence/upload" className={buttonClasses()}>
              Upload evidence
            </Link>
          ) : undefined
        }
      />

      {overview.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
      {overview.isError ? (
        <Card className="flex flex-col items-start gap-3">
          <Notice
            tone={overview.error instanceof ApiError && overview.error.code === 'no_framework' ? 'info' : 'error'}
          >
            {errorMessage(overview.error)}
          </Notice>
          {overview.error instanceof ApiError &&
          overview.error.code === 'no_framework' &&
          can('users_setup.manage', ['college']) ? (
            <Link href="/setup#frameworks" className={buttonClasses({ variant: 'secondary' })}>
              Choose a framework
            </Link>
          ) : null}
        </Card>
      ) : null}

      {data ? (
        <>
          {!data.framework.verified ? <UnverifiedNotice sourceTitle={data.framework.sourceTitle} /> : null}

          <Card className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[13px] text-muted">Framework for this college</span>
              <span className="text-[17px] font-bold">{data.framework.name}</span>
              {data.others.length ? (
                <div
                  className="mt-2 flex flex-wrap gap-2"
                  role="group"
                  aria-label="Other NAAC frameworks of your college"
                >
                  {[data.framework, ...data.others]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((framework) => (
                      <button
                        key={framework.id}
                        type="button"
                        aria-pressed={framework.id === data.framework.id}
                        onClick={() => setFrameworkId(framework.id)}
                        className={cn(
                          'min-h-11 cursor-pointer rounded-full border px-4 text-[13px] font-semibold',
                          framework.id === data.framework.id
                            ? 'border-primary bg-primary text-white'
                            : 'border-border bg-surface',
                        )}
                      >
                        {framework.name}
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
            <div className="flex min-w-64 flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-muted">Overall readiness</span>
                <span className="text-[28px] font-bold tabular-nums">{data.percent}%</span>
              </div>
              <ReadinessBar percent={data.percent} status={data.status} label="Overall readiness" />
              <span className="text-[13px] text-secondary">
                {attention.length
                  ? `${attention.length} ${attention.length === 1 ? 'criterion needs' : 'criteria need'} work`
                  : loaded.length
                    ? 'All criteria on track'
                    : 'Criteria load from the manual'}
              </span>
            </div>
          </Card>

          <div role="group" aria-label="Filter criteria" className="flex flex-wrap gap-2">
            {(
              [
                ['all', `All criteria (${data.criteria.length})`],
                ['attention', `Needs work (${attention.length})`],
                ['ok', `On track (${loaded.length - attention.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={cn(
                  'h-11 cursor-pointer rounded-full border px-4 text-[13px] font-semibold',
                  filter === id
                    ? 'border-primary bg-primary text-white'
                    : 'border-border bg-surface text-ink hover:bg-bg',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <section aria-label="Criteria" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((criterion) => (
              <CriterionCard key={criterion.number} criterion={criterion} frameworkId={data.framework.id} />
            ))}
          </section>

          {data.attention.length ? (
            <Card className="flex flex-col gap-4">
              <h2 className="text-[17px] font-bold">Metrics needing attention</h2>
              <Table>
                <thead>
                  <tr>
                    <Th>Metric</Th>
                    <Th>Criterion</Th>
                    <Th>Missing documents</Th>
                    <Th className="text-right">Done</Th>
                    <Th>
                      <span className="sr-only">Action</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {data.attention.map((metric) => (
                    <tr key={metric.metricId}>
                      <Td>
                        <span className="font-semibold">{metric.code}</span> {metric.name}
                      </Td>
                      <Td>C{metric.criterionNumber}</Td>
                      <Td className="text-secondary">{metric.missing.join(', ')}</Td>
                      <Td className="text-right tabular-nums">{metric.percent}%</Td>
                      <Td className="text-right">
                        <Link href={`/naac/metrics/${metric.metricId}`} className={buttonClasses({ variant: 'ghost' })}>
                          Open<span className="sr-only"> {metric.code}</span>
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function CriterionCard({ criterion, frameworkId }: { criterion: CriterionReadiness; frameworkId: string }) {
  if (criterion.pending) {
    return (
      <article className="flex flex-col gap-3 rounded-card border-[1.5px] border-dashed border-border bg-surface p-5 opacity-90">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-muted">Criterion {criterion.number}</span>
          <span className="rounded-full bg-row px-2.5 py-1 text-xs font-semibold text-muted">Awaiting manual</span>
        </div>
        <h2 className="text-[17px] font-bold">{criterion.name}</h2>
        <p className="text-sm text-secondary">Metrics load from the official NAAC manual.</p>
      </article>
    );
  }
  return (
    <article className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-muted">Criterion {criterion.number}</span>
        <ReadinessPill status={criterion.status} />
      </div>
      <h2 className="text-[17px] font-bold">{criterion.name}</h2>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[28px] font-bold tabular-nums">{criterion.percent}%</span>
        <span className="text-[13px] text-muted">complete</span>
      </div>
      <ReadinessBar
        percent={criterion.percent}
        status={criterion.status}
        label={`Criterion ${criterion.number} readiness`}
      />
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ['Metrics', `${criterion.metricsComplete} / ${criterion.metricsTotal}`],
          ['Evidence', criterion.evidence],
          ['Missing', criterion.missing],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col rounded-control bg-bg py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd
              className={cn(
                'text-[15px] font-bold tabular-nums',
                label === 'Missing' && Number(value) > 0 && 'text-red',
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <Link
        href={`/naac/criteria/${criterion.number}?framework=${frameworkId}`}
        className={buttonClasses({ variant: 'secondary' })}
      >
        Open metrics<span className="sr-only"> of criterion {criterion.number}</span>
      </Link>
    </article>
  );
}
