'use client';

import { useQuery } from '@tanstack/react-query';
import type { SetupStep, SetupStepState } from '@yucampus/types';
import { Card, cn } from '@yucampus/ui';
import Link from 'next/link';
import { api } from '@/lib/api';

export const SETUP_PROGRESS_KEY = ['institution', 'setup-progress'];

const HREF: Record<SetupStep['key'], string | null> = {
  profile: '#profile',
  departments: '#departments',
  users: '/users',
  calendar: '/setup/academic-year',
  templates: null,
};

const STATE_LABEL: Record<SetupStepState, string> = {
  done: 'Done',
  current: 'Up next',
  todo: 'Not done yet',
  later: 'Later',
};

export function SetupSteps() {
  const { data: steps, isPending, isError } = useQuery({
    queryKey: SETUP_PROGRESS_KEY,
    queryFn: () => api<SetupStep[]>('/institution/setup-progress'),
  });

  return (
    <Card className="flex flex-col gap-2 p-4 sm:p-4 xl:sticky xl:top-8">
      <h2 className="px-2 pb-1 text-[15px] font-bold">Setup progress</h2>
      {isPending ? <p className="px-2 text-sm text-muted">Loading…</p> : null}
      {isError ? <p className="px-2 text-sm text-red">Could not load progress.</p> : null}
      <ol className="flex flex-col gap-1">
        {steps?.map((step, index) => {
          const href = HREF[step.key];
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-7 flex-none items-center justify-center rounded-full text-[13px] font-bold',
                  step.state === 'done' && 'bg-teal text-white',
                  step.state === 'current' && 'bg-primary text-white',
                  (step.state === 'todo' || step.state === 'later') && 'bg-row text-muted',
                )}
              >
                {step.state === 'done' ? '✓' : index + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">{step.title}</span>
                <span className="text-xs text-muted">
                  {STATE_LABEL[step.state]} · {step.detail}
                </span>
              </span>
            </>
          );
          const classes = cn(
            'flex min-h-11 items-center gap-3 rounded-control px-2 py-2 text-ink no-underline',
            step.state === 'current' && 'bg-primary-soft',
          );
          return (
            <li key={step.key}>
              {href ? (
                <Link href={href} className={cn(classes, 'hover:bg-bg')} aria-current={step.state === 'current' ? 'step' : undefined}>
                  {content}
                </Link>
              ) : (
                <div className={classes}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
