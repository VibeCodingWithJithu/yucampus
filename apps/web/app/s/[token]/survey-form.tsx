'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { PublicSurveyView } from '@yucampus/types';
import { Button, Card, Notice, cn } from '@yucampus/ui';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api, errorMessage } from '@/lib/api';

const LABELS: Record<3 | 5, string[]> = {
  3: ['Disagree', 'Agree', 'Strongly agree'],
  5: ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'],
};

/**
 * A random token kept on this device so it answers each survey once. Only its hash reaches the server, and it says
 * nothing about the person. If the browser blocks storage, a fresh token is used (the answer is still accepted).
 */
function deviceToken(): string {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    const saved = localStorage.getItem('yc-survey-device');
    if (saved) return saved;
    const token = make();
    localStorage.setItem('yc-survey-device', token);
    return token;
  } catch {
    return make();
  }
}

export function SurveyForm() {
  const { token } = useParams<{ token: string }>();
  const survey = useQuery({
    queryKey: ['public-survey', token],
    queryFn: () => api<PublicSurveyView>(`/public/surveys/${token}`, { auth: false }),
    retry: false,
  });
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: () =>
      api(`/public/surveys/${token}/answers`, {
        method: 'POST',
        auth: false,
        body: {
          deviceToken: deviceToken(),
          answers: survey.data!.questions.map((q) => ({ questionId: q.id, rating: ratings[q.id] ?? null, comment: comments[q.id] ?? null })),
        },
      }),
  });

  if (survey.isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (survey.isError) return <Notice tone="error">{survey.error instanceof ApiError && survey.error.status === 404 ? 'This survey link is not valid.' : errorMessage(survey.error)}</Notice>;
  const data = survey.data;
  const done = submit.isSuccess || (submit.error instanceof ApiError && submit.error.code === 'already_answered');

  return (
    <>
      <div>
        <p className="text-[13px] text-muted">{data.college}</p>
        <h1 className="mt-1 text-2xl font-bold">{data.title}</h1>
        {data.status === 'open' && !done ? (
          <p className="mt-1.5 text-[15px] text-muted">For {data.audience.toLowerCase()}. Your answers are anonymous: nobody can see who answered what.</p>
        ) : null}
      </div>

      {done ? (
        <Notice tone="success">{submit.isSuccess ? 'Thank you! Your answers are saved.' : 'You have already answered this survey on this device. Thank you!'}</Notice>
      ) : data.status !== 'open' ? (
        <Notice tone="info">{data.status === 'draft' ? 'This survey has not opened yet. Please try again later.' : 'This survey is closed. Thank you for your interest.'}</Notice>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setProblem(null);
            const unanswered = data.questions.filter((q) => q.kind === 'rating' && !ratings[q.id]).length;
            if (unanswered) return setProblem(`Please answer all rating questions (${unanswered} left).`);
            submit.mutate();
          }}
        >
          {data.questions.map((q, index) =>
            q.kind === 'rating' ? (
              <Card key={q.id} className="p-4 sm:p-5">
                <fieldset className="flex flex-col gap-3">
                  <legend className="text-[15px] font-semibold">
                    {index + 1}. {q.text}
                  </legend>
                  <div className={cn('grid gap-2', q.scale === 3 ? 'grid-cols-3' : 'grid-cols-5')}>
                    {LABELS[q.scale].map((label, i) => {
                      const value = i + 1;
                      const chosen = ratings[q.id] === value;
                      return (
                        <label
                          key={label}
                          className={cn(
                            'flex min-h-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-control border px-1 py-2 text-center',
                            chosen ? 'border-primary bg-primary text-white' : 'border-border bg-surface hover:border-primary',
                          )}
                        >
                          <input type="radio" name={q.id} value={value} checked={chosen} onChange={() => setRatings({ ...ratings, [q.id]: value })} className="sr-only" />
                          <span className="text-base font-bold">{value}</span>
                          <span className={cn('text-[11px] leading-tight', chosen ? 'text-white' : 'text-muted')}>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </Card>
            ) : (
              <Card key={q.id} className="p-4 sm:p-5">
                <label className="flex flex-col gap-2 text-[15px] font-semibold">
                  {index + 1}. {q.text} <span className="text-[13px] font-normal text-muted">Optional</span>
                  <textarea
                    rows={3}
                    maxLength={2000}
                    className="w-full rounded-control border border-border bg-surface px-3.5 py-2.5 text-[15px] font-normal"
                    value={comments[q.id] ?? ''}
                    onChange={(e) => setComments({ ...comments, [q.id]: e.target.value })}
                  />
                </label>
              </Card>
            ),
          )}
          {problem ? <Notice tone="error">{problem}</Notice> : null}
          {submit.isError && !done ? <Notice tone="error">{errorMessage(submit.error)}</Notice> : null}
          <Button type="submit" size="lg" disabled={submit.isPending}>
            {submit.isPending ? 'Sending…' : 'Send answers'}
          </Button>
        </form>
      )}
    </>
  );
}
