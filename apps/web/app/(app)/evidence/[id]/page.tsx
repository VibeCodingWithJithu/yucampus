'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EvidenceDetail } from '@yucampus/types';
import { Button, Card, Field, Notice } from '@yucampus/ui';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { EvidenceStatus } from '@/components/evidence-status';
import { EvidencePreview } from '@/components/evidence-preview';
import { EvidenceVersions } from '@/components/evidence-versions';
import { MetricLinks } from '@/components/metric-links';
import { PageHeader } from '@/components/page-header';
import { EvidenceChecks, EvidenceFacts, EvidenceHistory, ReviewActions } from '@/components/review-panel';
import { api, errorMessage } from '@/lib/api';
import { EVIDENCE_ACCEPT, prepareFile, uploadFile } from '@/lib/upload';

export default function EvidencePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['evidence', id, 'detail'],
    queryFn: () => api<EvidenceDetail>(`/evidence/${id}`),
  });
  const item = detail.data;
  const update = (updated: EvidenceDetail) => queryClient.setQueryData(['evidence', id, 'detail'], updated);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'My uploads', href: '/evidence/mine' }, { label: 'Evidence' }]}
        title={item?.title ?? 'Evidence'}
      />
      {detail.isError ? <Notice tone="error">{errorMessage(detail.error)}</Notice> : null}
      {detail.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
      {item ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <Card>
            <EvidencePreview item={item} />
          </Card>
          <div className="flex flex-col gap-6">
            <Card className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-[17px] font-bold">Details</h2>
                <EvidenceStatus stage={item.stage} />
              </div>
              <EvidenceFacts item={item} />
              {item.status === 'needs_fix' && item.history.at(-1)?.comment ? (
                <Notice tone="error">
                  <span className="font-semibold">To fix: </span>
                  {item.history.at(-1)!.comment}
                </Notice>
              ) : null}
            </Card>
            <Card>
              <MetricLinks item={item} onChange={update} />
            </Card>
            {item.can.resubmit ? <FixAndResend key={item.version} item={item} onDone={update} /> : null}
            {item.can.review ? (
              <Card className="flex flex-col gap-4">
                <h2 className="text-[17px] font-bold">Your review</h2>
                <EvidenceChecks item={item} />
                <ReviewActions item={item} onDone={update} />
              </Card>
            ) : null}
            <Card>
              <EvidenceVersions id={item.id} version={item.version} />
            </Card>
            <Card className="flex flex-col gap-3">
              <h2 className="text-[17px] font-bold">History</h2>
              <EvidenceHistory item={item} />
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}

function FixAndResend({ item, onDone }: { item: EvidenceDetail; onDone: (updated: EvidenceDetail) => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(item.title);
  const [documentDate, setDocumentDate] = useState(item.documentDate ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function send() {
    setError(null);
    try {
      setProgress(0);
      let uploadToken: string | null = null;
      if (file) {
        const prepared = await prepareFile(file);
        uploadToken = await uploadFile(prepared.file, prepared.type, setProgress);
      }
      const updated = await api<EvidenceDetail>(`/evidence/${item.id}/resubmit`, {
        method: 'POST',
        body: { uploadToken, title, description: item.description, documentDate: documentDate || null },
      });
      void queryClient.invalidateQueries({ queryKey: ['evidence', 'mine'] });
      onDone(updated);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setProgress(null);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-[17px] font-bold">Fix and send again</h2>
      <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Field
        label="Date on the document"
        type="date"
        value={documentDate}
        onChange={(e) => setDocumentDate(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => input.current?.click()}>
          {file ? 'Choose a different file' : 'Replace the file'}
        </Button>
        <span className="text-sm text-muted">
          {file ? file.name : 'Optional: keep the same file if only the details were wrong.'}
        </span>
        <input
          ref={input}
          type="file"
          accept={EVIDENCE_ACCEPT}
          className="sr-only"
          aria-label="Replace the file"
          tabIndex={-1}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {progress !== null ? (
        <p role="status" className="text-sm text-muted">
          Sending… {Math.round(progress * 100)}%
        </p>
      ) : null}
      <div>
        <Button onClick={() => void send()} disabled={progress !== null}>
          Send again for review
        </Button>
      </div>
    </Card>
  );
}
