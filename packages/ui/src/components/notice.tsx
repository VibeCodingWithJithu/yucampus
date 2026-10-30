import type { ReactNode } from 'react';
import { cn } from '../cn';

type Tone = 'success' | 'error' | 'info';

const TONES: Record<Tone, string> = {
  success: 'bg-teal-soft text-teal-strong',
  error: 'bg-red-soft text-red-strong',
  info: 'bg-primary-soft text-primary',
};

/** A short message in a tinted box. Errors are announced immediately; the rest politely. */
export function Notice({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-control px-3.5 py-2.5 text-sm font-medium', TONES[tone], className)}
    >
      {children}
    </div>
  );
}
