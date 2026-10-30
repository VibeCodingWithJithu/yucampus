import type { ReadinessStatus } from '@yucampus/types';
import { StatusPill, type StatusTone, cn } from '@yucampus/ui';

const STATUS: Record<ReadinessStatus, { label: string; tone: StatusTone; bar: string }> = {
  on_track: { label: 'On track', tone: 'good', bar: 'bg-teal' },
  in_progress: { label: 'In progress', tone: 'neutral', bar: 'bg-primary' },
  needs_attention: { label: 'Needs attention', tone: 'attention', bar: 'bg-amber-fill' },
};

/** Colour plus words (accessibility rule). */
export function ReadinessPill({ status }: { status: ReadinessStatus }) {
  return <StatusPill tone={STATUS[status].tone}>{STATUS[status].label}</StatusPill>;
}

export function ReadinessBar({ percent, status, label }: { percent: number; status: ReadinessStatus; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 overflow-hidden rounded-full bg-track"
    >
      <div className={cn('h-full rounded-full', STATUS[status].bar)} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Shown wherever criteria come from a template not checked line by line against the official manual. */
export function UnverifiedNotice({ sourceTitle }: { sourceTitle: string }) {
  return (
    <div
      role="note"
      className="rounded-card border-2 border-amber-fill bg-amber-soft px-4 py-3 text-sm text-amber-strong"
    >
      <span className="font-bold">Not yet checked against the official manual. </span>
      {sourceTitle} Check the numbers with your IQAC before using them for a submission.
    </div>
  );
}
