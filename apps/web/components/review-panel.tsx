'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EvidenceDetail } from '@yucampus/types';
import { Button, Field, Notice, cn } from '@yucampus/ui';
import type { ReviewDecision } from '@yucampus/validation';
import { useId, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';

const ACTION_TEXT: Record<EvidenceDetail['history'][number]['action'], string> = {
  submitted: 'uploaded it',
  resubmitted: 'sent it again after fixing',
  approved: 'approved it',
  needs_fix: 'sent it back to fix',
  rejected: 'rejected it',
  remapped: 'changed its criteria',
};

export function EvidenceFacts({ item }: { item: EvidenceDetail }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted">Uploaded by</dt>
      <dd>
        {item.uploadedBy.name}
        {item.department ? `, ${item.department.code}` : ''}
      </dd>
      <dt className="text-muted">Academic year</dt>
      <dd>{item.academicYear.replace('-', '–')}</dd>
      <dt className="text-muted">Status</dt>
      <dd>{item.stage.label}</dd>
      {item.description ? (
        <>
          <dt className="text-muted">Note</dt>
          <dd className="whitespace-pre-line">{item.description}</dd>
        </>
      ) : null}
    </dl>
  );
}

export function EvidenceChecks({ item }: { item: EvidenceDetail }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Automatic checks">
      {item.checks.map((check) => (
        <li
          key={check.key}
          className={cn('flex items-start gap-2 text-sm', check.ok ? 'text-teal-strong' : 'text-amber-strong')}
        >
          <span aria-hidden="true" className="font-bold">
            {check.ok ? '✓' : '!'}
          </span>
          <span>
            <span className="sr-only">{check.ok ? 'Passed: ' : 'Check: '}</span>
            {check.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function EvidenceHistory({ item }: { item: EvidenceDetail }) {
  return (
    <ol className="flex flex-col gap-2 text-sm" aria-label="History">
      {item.history.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="flex flex-col">
          <span>
            <span className="font-semibold">{entry.by}</span> {ACTION_TEXT[entry.action]}
            {entry.level === 'department' ? ' (department level)' : entry.level === 'final' ? ' (final)' : ''}
            <span className="text-muted"> · {formatDateTime(entry.at)}</span>
          </span>
          {entry.comment ? (
            <span className="mt-0.5 rounded-control bg-bg px-3 py-2 text-secondary">“{entry.comment}”</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** The reviewer's decision: approve (with optional corrections), send back with a note, or reject with a reason. */
export function ReviewActions({ item, onDone }: { item: EvidenceDetail; onDone: (updated: EvidenceDetail) => void }) {
  const queryClient = useQueryClient();
  const commentId = useId();
  const [title, setTitle] = useState(item.title);
  const [documentDate, setDocumentDate] = useState(item.documentDate ?? '');
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState<ReviewDecision | null>(null);

  const decide = useMutation({
    mutationFn: (decision: ReviewDecision) =>
      api<EvidenceDetail>(`/evidence/${item.id}/review`, {
        method: 'POST',
        body:
          decision === 'approve'
            ? { decision, title, documentDate: documentDate || null, comment: comment || null }
            : { decision, comment },
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['review'] });
      void queryClient.invalidateQueries({ queryKey: ['evidence'] });
      setPending(null);
      setComment('');
      onDone(updated);
    },
  });

  // Sending back or rejecting needs a reason the uploader can act on.
  function choose(decision: ReviewDecision) {
    if (decision !== 'approve' && pending !== decision) return setPending(decision);
    decide.mutate(decision);
  }

  const level = item.can.review === 'department' ? 'for your department' : 'as final approval';
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <Field
          label="Date on the document"
          type="date"
          value={documentDate}
          onChange={(e) => setDocumentDate(e.target.value)}
        />
        <div className="flex items-end text-[13px] text-muted">
          {item.documentDate ? `Uploader said ${formatDate(item.documentDate)}` : 'Uploader gave no date'}
        </div>
      </div>

      {pending ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={commentId} className="text-[13px] font-semibold text-muted">
            {pending === 'needs_fix' ? 'What should they fix?' : 'Why is it rejected?'}
          </label>
          <textarea
            id={commentId}
            rows={3}
            autoFocus
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full rounded-control border border-border bg-surface px-3.5 py-3 text-[15px]"
          />
        </div>
      ) : null}

      {decide.isError ? <Notice tone="error">{errorMessage(decide.error)}</Notice> : null}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          className="text-red"
          disabled={decide.isPending || (pending === 'reject' && !comment.trim())}
          onClick={() => choose('reject')}
        >
          {pending === 'reject' ? 'Reject with this reason' : 'Reject'}
        </Button>
        <Button
          variant="secondary"
          disabled={decide.isPending || (pending === 'needs_fix' && !comment.trim())}
          onClick={() => choose('needs_fix')}
        >
          {pending === 'needs_fix' ? 'Send back with this note' : 'Send back to fix'}
        </Button>
        <Button disabled={decide.isPending} onClick={() => choose('approve')}>
          {decide.isPending ? 'Saving…' : 'Approve'}
        </Button>
        {pending ? (
          <Button variant="ghost" onClick={() => setPending(null)}>
            Cancel
          </Button>
        ) : null}
      </div>
      <p className="text-[13px] text-muted">You are approving {level}.</p>
    </div>
  );
}
