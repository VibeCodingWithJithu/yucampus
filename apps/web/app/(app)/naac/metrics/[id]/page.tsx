'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MetricDetailView } from '@yucampus/types';
import { Button, Card, Notice, StatusPill, buttonClasses, cn } from '@yucampus/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useId, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { MetricData } from '@/components/metric-data';
import { PageHeader } from '@/components/page-header';
import { ReadinessBar, ReadinessPill, UnverifiedNotice } from '@/components/readiness';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatYearLabel } from '@/lib/format';

export default function MetricPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const key = ['accreditation', 'metric', id];
  const metric = useQuery({ queryKey: key, queryFn: () => api<MetricDetailView>(`/metrics/${id}`) });
  const data = metric.data;
  const uploadHref = (documentKey: string) =>
    `/evidence/upload?metric=${id}&document=${encodeURIComponent(documentKey)}`;

  return (
    <>
      <PageHeader
        breadcrumb={
          data
            ? [
                { label: 'NAAC', href: '/naac' },
                {
                  label: `Criterion ${data.criterion.number}`,
                  href: `/naac/criteria/${data.criterion.number}?framework=${data.framework.id}`,
                },
                { label: data.code },
              ]
            : [{ label: 'NAAC', href: '/naac' }]
        }
        title={data ? `${data.code} · ${data.name}` : 'Metric'}
        actions={
          data && can('evidence.upload') ? (
            <Link
              href={uploadHref(data.documents.find((d) => !d.satisfied)?.key ?? data.documents[0]?.key ?? '')}
              className={buttonClasses()}
            >
              Upload evidence
            </Link>
          ) : undefined
        }
      />
      {metric.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
      {metric.isError ? <Notice tone="error">{errorMessage(metric.error)}</Notice> : null}
      {data ? (
        <>
          {!data.framework.verified ? <UnverifiedNotice sourceTitle={data.framework.sourceTitle} /> : null}
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-6">
              <Card className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <ReadinessPill status={data.status} />
                  <span className="text-sm font-bold tabular-nums">{data.percent}% complete</span>
                </div>
                <ReadinessBar percent={data.percent} status={data.status} label={`${data.code} readiness`} />
                <div>
                  <h2 className="text-[15px] font-bold">What this metric needs</h2>
                  <p className="mt-1 text-[15px] text-secondary">{data.plainLanguage}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusPill tone="neutral">
                    {data.yearsRequired === 1 ? 'Data for this year' : `Data for ${data.yearsRequired} years`}
                  </StatusPill>
                  <StatusPill tone="neutral">
                    {data.type === 'quantitative' ? 'Number-based metric' : 'Description-based metric'}
                  </StatusPill>
                </div>
                <p className="text-[13px] text-muted">
                  Counting evidence from {data.years.map(formatYearLabel).join(', ') || 'no academic year yet'}.
                </p>
              </Card>

              <Card className="flex flex-col gap-3">
                <h2 className="text-[17px] font-bold">Documents checklist</h2>
                <ul className="flex flex-col">
                  {data.documents.map((doc) => (
                    <li
                      key={doc.key}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-row py-3 last:border-b-0"
                    >
                      <span className="flex min-w-0 items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={cn(
                            'font-bold',
                            doc.satisfied ? 'text-teal' : doc.pending ? 'text-amber' : 'text-red',
                          )}
                        >
                          {doc.satisfied ? '✓' : doc.pending ? '…' : '!'}
                        </span>
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold">{doc.name}</span>
                          <span className="text-[13px] text-muted">
                            {doc.satisfied ? 'Done' : doc.pending ? 'Waiting for approval' : 'Missing'}
                            {` · ${doc.approved} approved`}
                            {doc.pending ? ` · ${doc.pending} in review` : ''}
                          </span>
                        </span>
                      </span>
                      {can('evidence.upload') ? (
                        <Link
                          href={uploadHref(doc.key)}
                          className={buttonClasses({ variant: doc.satisfied ? 'ghost' : 'secondary' })}
                        >
                          {doc.satisfied ? 'Add more' : 'Upload'}
                          <span className="sr-only"> {doc.name}</span>
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>

              {data.data ? <MetricData data={data.data} /> : null}

              <Card className="flex flex-col gap-3">
                <h2 className="text-[17px] font-bold">Linked evidence</h2>
                {data.evidence.length === 0 ? <p className="text-sm text-secondary">Nothing linked yet.</p> : null}
                <ul className="flex flex-col">
                  {data.evidence.map((item) => (
                    <li key={item.id} className="border-b border-row last:border-b-0">
                      <Link
                        href={`/evidence/${item.id}`}
                        className="flex min-h-12 items-center justify-between gap-3 py-2 text-ink no-underline"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{item.title}</span>
                          <span className="text-xs text-muted">
                            {item.uploadedBy} · {formatYearLabel(item.academicYear)}
                            {item.documentKey
                              ? ` · ${data.documents.find((d) => d.key === item.documentKey)?.name ?? ''}`
                              : ''}
                            {item.status === 'approved' && !item.counts ? ' · outside the years counted' : ''}
                          </span>
                        </span>
                        <StatusPill
                          tone={
                            item.status === 'approved' ? 'good' : item.status === 'needs_fix' ? 'problem' : 'attention'
                          }
                        >
                          {item.stageLabel}
                        </StatusPill>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <Comments metric={data} onChange={(updated) => queryClient.setQueryData(key, updated)} />
          </div>
        </>
      ) : null}
    </>
  );
}

function Comments({ metric, onChange }: { metric: MetricDetailView; onChange: (updated: MetricDetailView) => void }) {
  const [body, setBody] = useState('');
  const inputId = useId();
  const add = useMutation({
    mutationFn: () => api<MetricDetailView>(`/metrics/${metric.id}/comments`, { method: 'POST', body: { body } }),
    onSuccess: (updated) => {
      setBody('');
      onChange(updated);
    },
  });
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-[17px] font-bold">Comments</h2>
      {metric.comments.length === 0 ? <p className="text-sm text-secondary">No comments yet.</p> : null}
      <ul className="flex flex-col gap-3">
        {metric.comments.map((comment) => (
          <li key={comment.id} className="flex flex-col gap-0.5 rounded-control bg-bg px-3 py-2">
            <span className="text-xs text-muted">
              <span className="font-semibold text-ink">{comment.by}</span> · {formatDateTime(comment.at)}
            </span>
            <span className="text-sm whitespace-pre-line">{comment.body}</span>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim()) add.mutate();
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor={inputId} className="sr-only">
          Write a comment
        </label>
        <textarea
          id={inputId}
          rows={2}
          maxLength={2000}
          placeholder="Write a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-control border border-border bg-surface px-3.5 py-3 text-[15px]"
        />
        {add.isError ? <Notice tone="error">{errorMessage(add.error)}</Notice> : null}
        <div>
          <Button type="submit" variant="secondary" disabled={add.isPending || !body.trim()}>
            {add.isPending ? 'Posting…' : 'Post comment'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
