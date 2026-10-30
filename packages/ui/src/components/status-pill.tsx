import type { ReactNode } from 'react';
import { cn } from '../cn';

export type StatusTone = 'good' | 'attention' | 'problem' | 'neutral';

const TONES: Record<StatusTone, string> = {
  good: 'bg-teal-soft text-teal-strong',
  attention: 'bg-amber-soft text-amber-strong',
  problem: 'bg-red-soft text-red-strong',
  neutral: 'bg-primary-soft text-primary',
};

/** A status is never colour alone: the text label (children) is required. */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', TONES[tone], className)}
    >
      {children}
    </span>
  );
}
