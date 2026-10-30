'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcademicYearStatus, AcademicYearView, KeyDateView } from '@yucampus/types';
import { Button, Card, Dialog, Field, Notice, StatusPill, type StatusTone, cn } from '@yucampus/ui';
import { type AcademicYearDatesInput, type KeyDateInput, academicYearDatesSchema, keyDateSchema } from '@yucampus/validation';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { formatDate, formatYearLabel } from '@/lib/format';

const YEARS_KEY = ['academic-years'];

const STATUS: Record<AcademicYearStatus, { label: string; tone: StatusTone; note: string }> = {
  current: { label: 'Current', tone: 'good', note: 'Data collection in progress' },
  locked: { label: 'Locked', tone: 'neutral', note: 'Read only' },
  next: { label: 'Next', tone: 'attention', note: 'Not started yet' },
};

export function AcademicYearScreen() {
  const years = useQuery({ queryKey: YEARS_KEY, queryFn: () => api<AcademicYearView[]>('/academic-years') });
  const current = years.data?.find((year) => year.status === 'current');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = years.data?.find((year) => year.id === selectedId) ?? current;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Institution setup', href: '/setup' }, { label: 'Academic year and calendar' }]}
        title="Academic year and calendar"
        description="Set the year, its dates and deadlines. Every report and reminder follows this calendar."
      />

      {years.isError ? <Notice tone="error">{errorMessage(years.error)}</Notice> : null}
      {years.isPending ? <p className="text-sm text-muted">Loading…</p> : null}

      {years.data ? (
        <Card className="flex flex-col gap-4">
          <h2 className="text-[17px] font-bold">Academic years</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[...years.data].reverse().map((year) => (
              <button
                key={year.id}
                type="button"
                aria-pressed={selected?.id === year.id}
                onClick={() => setSelectedId(year.id)}
                className={cn(
                  'flex cursor-pointer flex-col items-start gap-2 rounded-card border bg-surface p-4 text-left',
                  selected?.id === year.id ? 'border-2 border-primary' : 'border-border hover:bg-bg',
                  year.status === 'next' && selected?.id !== year.id && 'border-dashed',
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-lg font-bold">{formatYearLabel(year.label)}</span>
                  <StatusPill tone={STATUS[year.status].tone}>{STATUS[year.status].label}</StatusPill>
                </span>
                <span className="text-[13px] text-muted">
                  {formatDate(year.startDate)} – {formatDate(year.endDate)}
                </span>
                <span className="text-[13px] text-secondary">{STATUS[year.status].note}</span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {selected ? (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <YearDates key={`dates-${selected.id}-${selected.startDate}-${selected.endDate}`} year={selected} />
          <KeyDates key={`dates-list-${selected.id}`} year={selected} />
        </div>
      ) : null}

      {current ? <StartNextYear current={current} next={years.data?.find((year) => year.status === 'next')} /> : null}
    </>
  );
}

function YearDates({ year }: { year: AcademicYearView }) {
  const queryClient = useQueryClient();
  const locked = year.status === 'locked';
  const { register, control, handleSubmit, formState } = useForm<AcademicYearDatesInput>({
    resolver: zodResolver(academicYearDatesSchema),
    defaultValues: { startDate: year.startDate, endDate: year.endDate, terms: year.terms },
  });
  const terms = useFieldArray({ control, name: 'terms' });
  const save = useMutation({
    mutationFn: (values: AcademicYearDatesInput) => api<AcademicYearView>(`/academic-years/${year.id}`, { method: 'PUT', body: values }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: YEARS_KEY }),
  });

  return (
    <Card>
      <h2 className="text-[17px] font-bold">Dates for {formatYearLabel(year.label)}</h2>
      <p className="mt-1 text-sm text-muted">
        {locked ? 'This year is locked, so its dates can no longer change.' : 'Evidence dated outside these dates is flagged during review.'}
      </p>
      <form noValidate onSubmit={handleSubmit((values) => save.mutate(values))} className="mt-5">
        <fieldset disabled={locked} className="flex flex-col gap-4">
          <legend className="sr-only">Year and semester dates</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Year starts" type="date" error={formState.errors.startDate?.message} {...register('startDate')} />
            <Field label="Year ends" type="date" error={formState.errors.endDate?.message} {...register('endDate')} />
          </div>
          {terms.fields.map((term, index) => (
            <div key={term.id} className="grid gap-3 rounded-control bg-bg p-3 sm:grid-cols-3">
              <Field label="Semester" error={formState.errors.terms?.[index]?.name?.message} {...register(`terms.${index}.name`)} />
              <Field label="Starts" type="date" error={formState.errors.terms?.[index]?.start?.message} {...register(`terms.${index}.start`)} />
              <Field label="Ends" type="date" error={formState.errors.terms?.[index]?.end?.message} {...register(`terms.${index}.end`)} />
            </div>
          ))}
          {formState.errors.terms?.message || formState.errors.terms?.root?.message ? (
            <p role="alert" className="text-[13px] text-red">
              {formState.errors.terms?.message ?? formState.errors.terms?.root?.message}
            </p>
          ) : null}
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          {save.isSuccess && !formState.isDirty ? <Notice tone="success">Dates saved.</Notice> : null}
          {!locked ? (
            <div>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save dates'}
              </Button>
            </div>
          ) : null}
        </fieldset>
      </form>
    </Card>
  );
}

function KeyDates({ year }: { year: AcademicYearView }) {
  const queryClient = useQueryClient();
  const locked = year.status === 'locked';
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: YEARS_KEY });
    void queryClient.invalidateQueries({ queryKey: ['institution', 'setup-progress'] });
  };
  const remove = useMutation({ mutationFn: (id: string) => api(`/key-dates/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-bold">Key dates and deadlines</h2>
        {!locked ? (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add a date
          </Button>
        ) : null}
      </div>
      {year.keyDates.length === 0 ? (
        <p className="text-sm text-secondary">No dates yet. Add audits, submissions and other deadlines so reminders go out on time.</p>
      ) : (
        <ul className="flex flex-col">
          {year.keyDates.map((keyDate) => (
            <li key={keyDate.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-row py-3 last:border-b-0">
              <span className="w-28 flex-none text-sm font-bold">{formatDate(keyDate.date)}</span>
              <span className="min-w-0 flex-1 text-sm">{keyDate.title}</span>
              <span className="text-[13px] text-muted">Reminder {keyDate.remindDaysBefore} days before</span>
              {!locked ? (
                <Button
                  variant="ghost"
                  className="text-red"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Remove "${keyDate.title}"?`)) remove.mutate(keyDate.id);
                  }}
                >
                  Remove<span className="sr-only"> {keyDate.title}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
      <p className="text-[13px] text-muted">Reminders are sent once notifications are switched on for your college.</p>
      <Dialog open={adding} onClose={() => setAdding(false)} title={`Add a date to ${formatYearLabel(year.label)}`}>
        {adding ? (
          <AddKeyDateForm
            yearId={year.id}
            onDone={() => {
              setAdding(false);
              refresh();
            }}
          />
        ) : null}
      </Dialog>
    </Card>
  );
}

function AddKeyDateForm({ yearId, onDone }: { yearId: string; onDone: () => void }) {
  const { register, handleSubmit, formState } = useForm<KeyDateInput>({
    resolver: zodResolver(keyDateSchema),
    defaultValues: { title: '', date: '', remindDaysBefore: 7 },
  });
  const add = useMutation({
    mutationFn: (values: KeyDateInput) => api<KeyDateView>(`/academic-years/${yearId}/key-dates`, { method: 'POST', body: values }),
    onSuccess: onDone,
  });
  return (
    <form noValidate onSubmit={handleSubmit((values) => add.mutate(values))} className="flex flex-col gap-4">
      <Field label="What is due" placeholder="e.g. AQAR submission" error={formState.errors.title?.message} {...register('title')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" type="date" error={formState.errors.date?.message} {...register('date')} />
        <Field
          label="Remind this many days before"
          type="number"
          inputMode="numeric"
          min={0}
          max={90}
          error={formState.errors.remindDaysBefore?.message}
          {...register('remindDaysBefore')}
        />
      </div>
      {add.isError ? <Notice tone="error">{errorMessage(add.error)}</Notice> : null}
      <div>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add date'}
        </Button>
      </div>
    </form>
  );
}

function StartNextYear({ current, next }: { current: AcademicYearView; next: AcademicYearView | undefined }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const start = useMutation({
    mutationFn: () => api<AcademicYearView[]>('/academic-years/start-next', { method: 'POST' }),
    onSuccess: (years) => {
      queryClient.setQueryData(YEARS_KEY, years);
      void queryClient.invalidateQueries({ queryKey: ['institution', 'setup-progress'] });
      setConfirming(false);
    },
  });

  if (!next) return null;
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-[17px] font-bold">Start the next academic year</h2>
      <p className="max-w-prose text-sm text-secondary">
        {formatYearLabel(current.label)} is locked for editing and {formatYearLabel(next.label)} becomes the current year.
        Departments, programs and people carry on as they are, so nothing is set up twice.
      </p>
      {start.data ? (
        <Notice tone="success">
          {formatYearLabel(start.data.find((year) => year.status === 'current')?.label ?? '')} is now the current year.
        </Notice>
      ) : (
        <div>
          <Button onClick={() => setConfirming(true)}>Start {formatYearLabel(next.label)}</Button>
        </div>
      )}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Start ${formatYearLabel(next.label)}?`}
        description={`${formatYearLabel(current.label)} will be locked and cannot be edited afterwards. Only do this when the year's data collection is finished.`}
      >
        <div className="flex flex-col gap-4">
          {start.isError ? <Notice tone="error">{errorMessage(start.error)}</Notice> : null}
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending ? 'Starting…' : `Lock ${formatYearLabel(current.label)} and start ${formatYearLabel(next.label)}`}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
