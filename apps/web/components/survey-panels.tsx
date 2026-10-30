'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SurveyView } from '@yucampus/types';
import { Button, Card, Field, Notice, StatusPill, cn } from '@yucampus/ui';
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const STATUS = { draft: { label: 'Draft', tone: 'neutral' }, open: { label: 'Open', tone: 'good' }, closed: { label: 'Closed', tone: 'attention' } } as const;

export function SurveyStatusPill({ status }: { status: SurveyView['status'] }) {
  return <StatusPill tone={STATUS[status].tone}>{STATUS[status].label}</StatusPill>;
}

/** The QR code as inline SVG, made in the browser (the library loads only when a survey is shown). */
function QrCode({ url }: { url: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('qrcode').then((qr) =>
      qr.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((text) => {
        if (!cancelled) setSvg(text);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!svg) return <div className="size-44 animate-pulse rounded-control bg-row" />;
  return (
    <div className="flex flex-col items-center gap-2">
      <div role="img" aria-label="QR code for the survey link" className="size-44 rounded-control bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />
      <Button
        variant="secondary"
        onClick={() => {
          const link = document.createElement('a');
          link.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          link.download = 'survey-qr-code.svg';
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        }}
      >
        Download QR code
      </Button>
    </div>
  );
}

/** Link, QR code and open/close. Answers are anonymous; sharing is done by hand (WhatsApp later). */
export function SurveyShare({ survey }: { survey: SurveyView }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const url = typeof window === 'undefined' ? survey.link : `${window.location.origin}${survey.link}`;
  const status = useMutation({
    mutationFn: (next: 'open' | 'closed') => api<SurveyView>(`/surveys/${survey.id}/status`, { method: 'PUT', body: { status: next } }),
    onSuccess: (view) => {
      queryClient.setQueryData(['surveys', 'one', view.id], view);
      void queryClient.invalidateQueries({ queryKey: ['surveys'] });
      void queryClient.invalidateQueries({ queryKey: ['nba', 'course'] });
    },
  });
  return (
    <Card aria-labelledby="share-h" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="share-h" className="text-[17px] font-bold">
          Share
        </h2>
        <SurveyStatusPill status={survey.status} />
      </div>
      {survey.status === 'draft' ? <p className="text-sm text-muted">Open the survey to start taking answers. Until then the link shows no questions.</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Open link" readOnly value={url} className="min-w-0 flex-1" onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
      <QrCode url={url} />
      <p className="text-[13px] leading-relaxed text-muted">
        Share the link in WhatsApp groups or by email, or show the QR code in class. Answers are anonymous and each device can answer once.
        To remind people, share the link again.
      </p>
      {survey.can.manage ? (
        <div className="flex flex-wrap gap-2">
          {survey.status !== 'open' ? (
            <Button disabled={status.isPending} onClick={() => status.mutate('open')}>
              {survey.status === 'closed' ? 'Open again' : 'Open survey'}
            </Button>
          ) : (
            <Button variant="secondary" disabled={status.isPending} onClick={() => status.mutate('closed')}>
              Close survey
            </Button>
          )}
        </div>
      ) : null}
      {status.isError ? <Notice tone="error">{errorMessage(status.error)}</Notice> : null}
      {survey.courseNote ? <Notice tone="info">{survey.courseNote}</Notice> : null}
    </Card>
  );
}

/** Average and spread per rating question; written comments, newest first and searchable. */
export function SurveyResults({ survey }: { survey: SurveyView }) {
  const [search, setSearch] = useState('');
  const comments = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? survey.comments.filter((c) => c.text.toLowerCase().includes(term)) : survey.comments;
  }, [search, survey.comments]);
  const ratings = survey.questions.filter((q) => q.kind === 'rating');
  return (
    <Card aria-labelledby="res-h" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id="res-h" className="text-[17px] font-bold">
          Results · {survey.title}
        </h2>
        <span className="flex flex-wrap gap-1.5">
          {survey.feeds.map((f) => (
            <span key={f} className="rounded-md bg-primary-soft px-2 py-1 text-[11px] font-bold text-primary">
              {f}
            </span>
          ))}
        </span>
      </div>
      <p className="text-sm text-muted">
        {survey.responses} {survey.responses === 1 ? 'answer' : 'answers'}
        {survey.expected ? ` of ${survey.expected} expected (${survey.rate}%)` : ''}
        {survey.closesOn ? ` · closes ${survey.closesOn}` : ''}
      </p>
      {survey.responses === 0 ? <p className="text-sm text-muted">Results will appear here once answers arrive.</p> : null}
      <ul className="flex flex-col gap-3.5">
        {ratings.map((q) => (
          <li key={q.id} className="flex flex-col gap-1.5">
            <div className="flex justify-between gap-3 text-sm">
              <span>
                {q.courseOutcome ? <span className="mr-1.5 font-bold text-primary">{q.courseOutcome.code}</span> : null}
                {q.text}
              </span>
              <span className="flex-none font-bold tabular-nums">{q.average === null ? '–' : `${q.average.toFixed(1)} / ${q.scale}`}</span>
            </div>
            <div
              role="img"
              aria-label={`${q.text}: average ${q.average ?? 'none'} of ${q.scale}, ${q.answers} answers`}
              className="h-2 overflow-hidden rounded-full bg-row"
            >
              {q.average !== null ? (
                <div
                  className={cn('h-2 rounded-full', q.average / q.scale >= 0.8 ? 'bg-teal' : q.average / q.scale >= 0.7 ? 'bg-primary' : 'bg-amber-fill')}
                  style={{ width: `${(q.average / q.scale) * 100}%` }}
                />
              ) : null}
            </div>
            <span className="text-xs text-muted">
              {q.distribution.map((n, i) => `${i + 1}: ${n}`).join(' · ')} ({q.answers} answers)
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 rounded-[10px] bg-bg p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-[13px] font-bold">What people wrote ({survey.comments.length})</h3>
          {survey.comments.length > 5 ? <Field label="Search comments" type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" /> : null}
        </div>
        {comments.length === 0 ? <p className="text-sm text-muted">{survey.comments.length ? 'No comment matches.' : 'No written comments yet.'}</p> : null}
        <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {comments.map((c, i) => (
            <li key={`${c.at}-${i}`} className="rounded-control bg-surface px-3 py-2 text-sm">
              <p className="whitespace-pre-line">{c.text}</p>
              <p className="mt-1 text-xs text-muted">{formatDateTime(c.at)}</p>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
