'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccreditationBody, DepartmentView, FrameworkOption, FrameworksView } from '@yucampus/types';
import { Button, Card, Checkbox, Field, Notice, SelectField, cn } from '@yucampus/ui';
import { type CycleInput, cycleSchema } from '@yucampus/validation';
import { useEffect, useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';

export const FRAMEWORKS_KEY = ['institution', 'frameworks'];

const BODY_DESCRIPTION: Record<AccreditationBody, string> = {
  NAAC: 'Whole institution. One framework is active in each assessment cycle.',
  NBA: 'Programme by programme.',
  NIRF: 'National ranking. Choose every category you take part in.',
  AISHE: 'Yearly higher-education survey.',
};

export function FrameworksSection() {
  const view = useQuery({ queryKey: FRAMEWORKS_KEY, queryFn: () => api<FrameworksView>('/institution/frameworks') });
  const bodies = [...new Set(view.data?.options.map((option) => option.body))];

  return (
    <Card id="frameworks" className="flex scroll-mt-8 flex-col gap-5">
      <div>
        <h2 className="text-[17px] font-bold">Which frameworks apply</h2>
        <p className="mt-1 text-sm text-muted">
          The right criteria, metrics and report formats load automatically. Switching keeps all data, so you can switch
          back.
        </p>
      </div>
      {view.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
      {view.isError ? <Notice tone="error">{errorMessage(view.error)}</Notice> : null}
      {view.data
        ? bodies.map((body) => {
            const options = view.data.options.filter((option) => option.body === body);
            return options.every((option) => option.attachesTo === 'program') ? (
              <ProgramLevelBody key={body} body={body} />
            ) : (
              <CollegeLevelBody key={body} body={body} options={options.filter((o) => o.attachesTo === 'college')} view={view.data} />
            );
          })
        : null}
    </Card>
  );
}

function BodyHeading({ body }: { body: AccreditationBody }) {
  return (
    <div>
      <h3 className="text-[15px] font-bold">{body}</h3>
      <p className="text-[13px] text-muted">{BODY_DESCRIPTION[body]}</p>
    </div>
  );
}

function NotLoaded({ option }: { option: FrameworkOption }) {
  if (option.criteriaCount > 0) return null;
  return <span className="block text-[13px] text-amber">Criteria not loaded into YuCampus yet; you can still choose it.</span>;
}

/** NAAC, NIRF, AISHE: chosen for the whole college; NAAC per assessment cycle. */
function CollegeLevelBody({ body, options, view }: { body: AccreditationBody; options: FrameworkOption[]; view: FrameworksView }) {
  const queryClient = useQueryClient();
  const single = options.every((option) => option.selection === 'single');
  const cycles = view.cycles.filter((cycle) => cycle.body === body);
  const usesCycles = single;
  const [cycleId, setCycleId] = useState<string | null>(null);
  // Open on the cycle picked, else the newest one that has a framework chosen, else the newest.
  const withFramework = cycles.filter((cycle) => view.college.some((row) => row.active && row.cycleId === cycle.id));
  const activeCycle = usesCycles
    ? (cycles.find((cycle) => cycle.id === cycleId) ?? withFramework.at(-1) ?? cycles.at(-1) ?? null)
    : null;
  const rowCycle = activeCycle?.id ?? null;

  const activeIds = view.college
    .filter((row) => row.active && row.cycleId === rowCycle && options.some((option) => option.id === row.frameworkId))
    .map((row) => row.frameworkId);
  const [chosen, setChosen] = useState<string[]>(activeIds);
  const activeKey = activeIds.join(',');
  useEffect(() => setChosen(activeKey ? activeKey.split(',') : []), [activeKey]);

  const save = useMutation({
    mutationFn: () =>
      api<FrameworksView>('/institution/frameworks', { method: 'PUT', body: { body, cycleId: rowCycle, frameworkIds: chosen } }),
    onSuccess: (saved) => queryClient.setQueryData(FRAMEWORKS_KEY, saved),
  });
  const groupName = useId();
  const changed = chosen.slice().sort().join(',') !== activeIds.slice().sort().join(',');

  return (
    <section className="flex flex-col gap-3 border-t border-row pt-4" aria-label={body}>
      <BodyHeading body={body} />

      {usesCycles ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {cycles.length ? (
            <div className="sm:w-72">
              <SelectField label={`${body} assessment cycle`} value={activeCycle?.id ?? ''} onChange={(event) => setCycleId(event.target.value)}>
                {cycles.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.label}
                    {cycle.startDate && cycle.endDate ? ` (${formatDate(cycle.startDate)} – ${formatDate(cycle.endDate)})` : ''}
                  </option>
                ))}
              </SelectField>
            </div>
          ) : (
            <p className="text-sm text-secondary">Add your current {body} assessment cycle to choose its framework.</p>
          )}
          <AddCycle body={body} onAdded={(id) => setCycleId(id)} />
        </div>
      ) : null}

      {!usesCycles || activeCycle ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{body} frameworks{activeCycle ? ` for ${activeCycle.label}` : ''}</legend>
          {single ? (
            <>
              {[{ id: '', name: `Not applying for ${body}${activeCycle ? ' in this cycle' : ''}`, criteriaCount: 1 } as FrameworkOption, ...options].map(
                (option) => (
                  <label
                    key={option.id || 'none'}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-start gap-3 rounded-control border border-border px-3.5 py-3',
                      (chosen[0] ?? '') === option.id && 'border-primary bg-primary-soft',
                    )}
                  >
                    <input
                      type="radio"
                      name={groupName}
                      className="mt-0.5 size-5 flex-none accent-primary"
                      checked={(chosen[0] ?? '') === option.id}
                      onChange={() => setChosen(option.id ? [option.id] : [])}
                    />
                    <span className="text-sm">
                      <span className="font-semibold">{option.name}</span>
                      {option.id ? <NotLoaded option={option} /> : null}
                    </span>
                  </label>
                ),
              )}
            </>
          ) : (
            options.map((option) => (
              <Checkbox
                key={option.id}
                label={option.name}
                description={<NotLoaded option={option} />}
                checked={chosen.includes(option.id)}
                onChange={(event) =>
                  setChosen((list) => (event.target.checked ? [...list, option.id] : list.filter((id) => id !== option.id)))
                }
              />
            ))
          )}
        </fieldset>
      ) : null}

      {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
      {save.isSuccess && !changed ? <Notice tone="success">{body} saved.</Notice> : null}
      {!usesCycles || activeCycle ? (
        <div>
          <Button variant={changed ? 'primary' : 'secondary'} onClick={() => save.mutate()} disabled={save.isPending || !changed}>
            {save.isPending ? 'Saving…' : `Save ${body}`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function AddCycle({ body, onAdded }: { body: AccreditationBody; onAdded: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, formState, reset } = useForm<CycleInput>({
    resolver: zodResolver(cycleSchema),
    defaultValues: { body, label: '', startDate: null, endDate: null },
  });
  const add = useMutation({
    mutationFn: (values: CycleInput) => api<FrameworksView>('/institution/cycles', { method: 'POST', body: values }),
    onSuccess: (saved, values) => {
      queryClient.setQueryData(FRAMEWORKS_KEY, saved);
      const created = saved.cycles.find((cycle) => cycle.body === body && cycle.label === values.label);
      if (created) onAdded(created.id);
      reset({ body, label: '', startDate: null, endDate: null });
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Add a cycle
      </Button>
    );
  }
  const blankToNull = { setValueAs: (value: string) => value || null };
  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => add.mutate(values))}
      className="grid w-full gap-3 rounded-control bg-bg p-3 sm:grid-cols-3"
      aria-label={`Add a ${body} cycle`}
    >
      <Field label="Cycle name" placeholder="e.g. Cycle 3" error={formState.errors.label?.message} {...register('label')} />
      <Field label="Starts (optional)" type="date" {...register('startDate', blankToNull)} />
      <Field label="Ends (optional)" type="date" error={formState.errors.endDate?.message} {...register('endDate', blankToNull)} />
      {add.isError ? <Notice tone="error" className="sm:col-span-3">{errorMessage(add.error)}</Notice> : null}
      <div className="flex gap-3 sm:col-span-3">
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add cycle'}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** NBA: chosen per program in the departments table, so this only summarises. */
function ProgramLevelBody({ body }: { body: AccreditationBody }) {
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api<DepartmentView[]>('/departments') });
  const programs = departments.data?.flatMap((department) => department.programs) ?? [];
  const inScope = programs.filter((program) => program.framework);
  return (
    <section className="flex flex-col gap-2 border-t border-row pt-4" aria-label={body}>
      <BodyHeading body={body} />
      <p className="text-sm text-secondary">
        {departments.data
          ? inScope.length
            ? `${inScope.length} of ${programs.length} programs are assessed by ${body}: ${inScope.map((p) => `${p.name} (${p.framework!.name})`).join('; ')}.`
            : `No programs are assessed by ${body} yet.`
          : 'Loading…'}{' '}
        Choose the format (discipline and tier) on each program: Departments and programs → Edit.
      </p>
    </section>
  );
}
