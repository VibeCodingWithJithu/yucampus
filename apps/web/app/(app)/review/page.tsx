'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EvidenceDetail, ReviewQueue } from '@yucampus/types';
import { Button, Card, Notice, cn } from '@yucampus/ui';
import { useEffect, useState } from 'react';
import { EvidenceStatus } from '@/components/evidence-status';
import { EvidencePreview } from '@/components/evidence-preview';
import { MetricLinks } from '@/components/metric-links';
import { PageHeader } from '@/components/page-header';
import { EvidenceChecks, EvidenceFacts, EvidenceHistory, ReviewActions } from '@/components/review-panel';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

export default function ReviewPage() {
  const queryClient = useQueryClient();
  const queue = useQuery({ queryKey: ['review', 'queue'], queryFn: () => api<ReviewQueue>('/review/queue') });
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const items = queue.data?.items ?? [];
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === currentId),
  );
  const current = items[index];
  useEffect(() => {
    if (!currentId && items[0]) setCurrentId(items[0].id);
  }, [currentId, items]);

  const detail = useQuery({
    queryKey: ['evidence', current?.id, 'detail'],
    queryFn: () => api<EvidenceDetail>(`/evidence/${current!.id}`),
    enabled: Boolean(current),
  });

  function done(updated: EvidenceDetail) {
    const verb = updated.status === 'needs_fix' ? 'Sent back' : updated.status === 'rejected' ? 'Rejected' : 'Approved';
    setMessage(
      `${verb}: “${updated.title}”.${updated.stage.waitingFor === 'final' ? ' It now goes for final approval.' : ''}`,
    );
    setCurrentId(items[index + 1]?.id ?? items[index - 1]?.id ?? null);
  }

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Review queue' }]}
        title="Review uploaded evidence"
        description={
          queue.data
            ? queue.data.total
              ? `Item ${index + 1} of ${queue.data.total} · check the details before approving`
              : 'Nothing is waiting for you.'
            : undefined
        }
        actions={
          items.length > 1 ? (
            <>
              <Button
                variant="secondary"
                aria-label="Previous item"
                disabled={index === 0}
                onClick={() => setCurrentId(items[index - 1]!.id)}
              >
                ← Previous
              </Button>
              <Button
                variant="secondary"
                aria-label="Next item"
                disabled={index >= items.length - 1}
                onClick={() => setCurrentId(items[index + 1]!.id)}
              >
                Next →
              </Button>
            </>
          ) : undefined
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {queue.isError ? <Notice tone="error">{errorMessage(queue.error)}</Notice> : null}
      {queue.isPending ? <p className="text-sm text-muted">Loading…</p> : null}

      {queue.data && items.length === 0 ? (
        <Card>
          <h2 className="text-[17px] font-bold">All caught up</h2>
          <p className="mt-1 text-sm text-secondary">New uploads that need your approval will appear here.</p>
        </Card>
      ) : null}

      {current ? (
        <div className="grid items-start gap-6 xl:grid-cols-[260px_minmax(0,1fr)_minmax(0,420px)]">
          <Card className="hidden flex-col gap-1 p-3 sm:p-3 xl:flex">
            <h2 className="px-2 py-1 text-sm font-bold">Waiting ({queue.data?.total})</h2>
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setCurrentId(item.id)}
                    aria-current={item.id === current.id ? 'true' : undefined}
                    className={cn(
                      'flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-control px-2 py-2 text-left',
                      item.id === current.id ? 'bg-primary-soft' : 'hover:bg-bg',
                    )}
                  >
                    <span className="line-clamp-2 text-sm font-semibold">{item.title}</span>
                    <span className="text-xs text-muted">
                      {item.uploadedBy.name}
                      {item.department ? ` · ${item.department.code}` : ''} · {formatDateTime(item.uploadedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card aria-label="Document preview">
            <EvidencePreview item={current} />
          </Card>

          <Card className="flex flex-col gap-5">
            {detail.isError ? <Notice tone="error">{errorMessage(detail.error)}</Notice> : null}
            {!detail.data ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[17px] font-bold">{detail.data.title}</h2>
                  <EvidenceStatus stage={detail.data.stage} />
                </div>
                <EvidenceFacts item={detail.data} />
                <EvidenceChecks item={detail.data} />
                <MetricLinks
                  item={detail.data}
                  onChange={(updated) => queryClient.setQueryData(['evidence', updated.id, 'detail'], updated)}
                />
                {detail.data.can.review ? (
                  <ReviewActions key={detail.data.id} item={detail.data} onDone={done} />
                ) : (
                  <Notice tone="info">This is no longer waiting for you.</Notice>
                )}
                <details>
                  <summary className="cursor-pointer text-sm font-semibold">History</summary>
                  <div className="mt-3">
                    <EvidenceHistory item={detail.data} />
                  </div>
                </details>
              </>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
