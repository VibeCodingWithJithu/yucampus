'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcademicYearView, AttainmentRules, ProgramNbaView, TaskAssignees } from '@yucampus/types';
import { Button, Card, Dialog, Field, Notice, SelectField, StatusPill, Table, Td, Th, cn } from '@yucampus/ui';
import { type CourseInput, courseInputSchema } from '@yucampus/validation';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { formatYearLabel } from '@/lib/format';

interface ProgramOption {
  id: string;
  name: string;
  departmentCode: string;
  nbaFormat: string | null;
}

const value = (v: number | null) => (v === null ? '–' : v.toFixed(2));

export function NbaScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [yearId, setYearId] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const [editingPsos, setEditingPsos] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const programs = useQuery({ queryKey: ['nba', 'programs'], queryFn: () => api<ProgramOption[]>('/nba/programs') });
  const years = useQuery({ queryKey: ['academic-years'], queryFn: () => api<AcademicYearView[]>('/academic-years') });
  useEffect(() => {
    if (!yearId && years.data) setYearId(years.data.find((y) => y.status === 'current')?.id ?? '');
  }, [yearId, years.data]);
  const programId = params.get('program') ?? programs.data?.[0]?.id ?? '';
  const view = useQuery({
    queryKey: ['nba', 'program', programId, yearId],
    queryFn: () => api<ProgramNbaView>(`/nba/programs/${programId}${yearId ? `?year=${yearId}` : ''}`),
    enabled: Boolean(programId),
    placeholderData: keepPreviousData,
  });
  const data = view.data;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'NBA' }]}
        title="NBA outcomes and attainment"
        description="Course outcomes, CO–PO mapping and attainment, worked out from the totals teachers enter."
        actions={data?.can.addCourse ? <Button onClick={() => setAdding(true)}>Add a course</Button> : undefined}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {programs.data?.length === 0 ? <Notice tone="info">No programs to show. Courses you teach will appear here once your HOD adds them.</Notice> : null}

      <div className="flex flex-wrap items-end gap-3">
        <SelectField
          label="Program"
          value={programId}
          onChange={(e) => router.replace(`${pathname}?program=${e.target.value}`, { scroll: false })}
          className="min-w-64"
        >
          {programs.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.departmentCode}){p.nbaFormat ? '' : ' · no NBA format'}
            </option>
          ))}
        </SelectField>
        <SelectField label="Academic year" value={yearId} onChange={(e) => setYearId(e.target.value)} className="w-36">
          {years.data?.map((y) => (
            <option key={y.id} value={y.id}>
              {formatYearLabel(y.label)}
            </option>
          ))}
        </SelectField>
      </div>
      {view.isError ? <Notice tone="error">{errorMessage(view.error)}</Notice> : null}

      {data ? (
        <>
          <Card aria-labelledby="courses-h" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="courses-h" className="text-[17px] font-bold">
                Courses · {formatYearLabel(data.academicYear.label)}
              </h2>
              <span className="text-[13px] text-muted">{data.program.nbaFormat ? `NBA ${data.program.nbaFormat}` : 'No NBA format chosen'}</span>
            </div>
            {data.courses.length === 0 ? (
              <p className="text-sm text-muted">{data.can.addCourse ? 'No courses yet. Add the first one.' : 'No courses yet.'}</p>
            ) : (
              <Table aria-labelledby="courses-h" className="min-w-[640px]">
                <thead>
                  <tr>
                    <Th>Course</Th>
                    <Th>Semester</Th>
                    <Th>Teacher</Th>
                    <Th>COs</Th>
                    <Th>Attainment</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.courses.map((c) => (
                    <tr key={c.id}>
                      <Td className="font-semibold">
                        <Link href={`/nba/courses/${c.id}`}>
                          {c.code} · {c.name}
                        </Link>
                      </Td>
                      <Td>{c.semester ?? '–'}</Td>
                      <Td>{c.teacher?.name ?? <span className="text-muted">Not assigned</span>}</Td>
                      <Td className="tabular-nums">{c.outcomes}</Td>
                      <Td className="tabular-nums">{c.attainment === null ? <span className="text-muted">Not complete</span> : `${value(c.attainment)} of 3`}</Td>
                      <Td>{c.status === 'locked' ? <StatusPill tone="good">Locked</StatusPill> : <StatusPill tone="neutral">Draft</StatusPill>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card aria-labelledby="po-h" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="po-h" className="text-[17px] font-bold">
                Program outcome attainment
              </h2>
              {data.can.manage ? (
                <Button variant="secondary" onClick={() => setEditingPsos(true)}>
                  Edit PSOs
                </Button>
              ) : null}
            </div>
            <p className="text-[13px] text-muted">From locked courses only: each course's COs, weighted by their mapping strength.</p>
            {data.outcomesSource && !data.outcomesSource.verified ? <p className="text-xs text-amber-strong">{data.outcomesSource.title}</p> : null}
            {data.outcomes.length === 0 ? (
              <Notice tone="info">NBA's outcomes for this program's discipline are not loaded yet. Engineering programs get them automatically.</Notice>
            ) : (
              <Table aria-labelledby="po-h" className="min-w-[560px]">
                <thead>
                  <tr>
                    <Th>Outcome</Th>
                    <Th>Statement</Th>
                    <Th className="text-right">Attainment</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.outcomes.map((o) => {
                    const att = data.poAttainment.find((p) => p.outcomeId === o.id);
                    return (
                      <tr key={o.id}>
                        <Td className="font-bold text-primary">{o.code}</Td>
                        <Td className="text-[13px]">{o.statement}</Td>
                        <Td className="text-right whitespace-nowrap tabular-nums">
                          {att?.value === null || att === undefined ? <span className="text-muted">–</span> : `${value(att.value)} (${att.courses} course${att.courses === 1 ? '' : 's'})`}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <Card aria-labelledby="profile-h" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="profile-h" className="text-[17px] font-bold">
                Vision, mission and PEOs
              </h2>
              {data.can.manage ? (
                <Button variant="secondary" onClick={() => setEditingProfile(true)}>
                  Edit
                </Button>
              ) : null}
            </div>
            <p className="text-[13px] text-muted">Criterion 1 of the SAR.</p>
            {!data.profile.vision && !data.profile.mission && data.profile.peos.length === 0 ? (
              <p className="text-sm text-muted">Not entered yet.</p>
            ) : (
              <dl className="flex flex-col gap-2 text-sm">
                <dt className="font-semibold">Vision</dt>
                <dd className="whitespace-pre-line">{data.profile.vision || <span className="text-red">Not entered</span>}</dd>
                <dt className="font-semibold">Mission</dt>
                <dd className="whitespace-pre-line">{data.profile.mission || <span className="text-red">Not entered</span>}</dd>
                <dt className="font-semibold">Program educational objectives</dt>
                <dd>
                  {data.profile.peos.length ? (
                    <ul className="flex flex-col gap-1">
                      {data.profile.peos.map((peo) => (
                        <li key={peo.code}>
                          <span className="font-bold text-primary">{peo.code}</span> {peo.statement}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-red">Not entered</span>
                  )}
                </dd>
              </dl>
            )}
          </Card>

          <Card aria-labelledby="rules-h" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="rules-h" className="text-[17px] font-bold">
                Attainment rules
              </h2>
              {data.can.manage ? (
                <Button variant="secondary" onClick={() => setEditingRules(true)}>
                  Change rules
                </Button>
              ) : null}
            </div>
            <RulesSummary rules={data.rules} />
          </Card>

          <CourseDialog
            open={adding}
            programId={data.program.id}
            yearId={data.academicYear.id}
            onClose={(text) => {
              setAdding(false);
              if (text) setMessage(text);
            }}
          />
          <RulesDialog open={editingRules} view={data} onClose={() => setEditingRules(false)} />
          <PsoDialog open={editingPsos} view={data} onClose={() => setEditingPsos(false)} />
          <ProfileDialog open={editingProfile} view={data} onClose={() => setEditingProfile(false)} />
        </>
      ) : null}
    </>
  );
}

export function RulesSummary({ rules }: { rules: AttainmentRules }) {
  return (
    <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
      <li>Target mark: {rules.targetMarkPercent}% of the maximum</li>
      <li>
        Levels: 3 at {rules.levels.level3}% of students, 2 at {rules.levels.level2}%, 1 at {rules.levels.level1}%
      </li>
      <li>
        Direct = {rules.internalWeight}% internal + {rules.endExamWeight}% end exam
      </li>
      <li>
        Final = {rules.directWeight}% direct + {rules.indirectWeight}% indirect (course exit survey)
      </li>
      <li>CO target: {rules.coTarget} of 3</li>
    </ul>
  );
}

function CourseDialog({ open, programId, yearId, onClose }: { open: boolean; programId: string; yearId: string; onClose: (message?: string) => void }) {
  const queryClient = useQueryClient();
  const people = useQuery({ queryKey: ['tasks', 'assignees'], queryFn: () => api<TaskAssignees>('/tasks/assignees'), enabled: open });
  const { register, handleSubmit, formState, reset } = useForm<CourseInput>({ resolver: zodResolver(courseInputSchema), defaultValues: { academicYearId: yearId } });
  const save = useMutation({
    mutationFn: (body: CourseInput) => api<{ code: string; name: string }>(`/nba/programs/${programId}/courses`, { method: 'POST', body }),
    onSuccess: (course) => {
      void queryClient.invalidateQueries({ queryKey: ['nba'] });
      reset({ academicYearId: yearId });
      onClose(`Added ${course.code} · ${course.name}.`);
    },
  });
  return (
    <Dialog open={open} onClose={() => onClose()} title="Add a course" description="The teacher you choose can then enter its COs, mapping and results.">
      <form noValidate onSubmit={handleSubmit((v) => save.mutate({ ...v, academicYearId: yearId, teacherId: v.teacherId || null }))} className="flex flex-col gap-4">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Course code" placeholder="CS501" error={formState.errors.code?.message} {...register('code')} />
          <Field label="Semester (optional)" type="number" inputMode="numeric" error={formState.errors.semester?.message} {...register('semester', { setValueAs: (v: string) => (v === '' ? null : Number(v)) })} />
          <div className="sm:col-span-2">
            <Field label="Course name" placeholder="Machine Learning" error={formState.errors.name?.message} {...register('name')} />
          </div>
          <SelectField label="Teacher (optional)" className="sm:col-span-2" {...register('teacherId')}>
            <option value="">Not assigned yet</option>
            {people.data?.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.detail ? ` (${p.detail})` : ''}
              </option>
            ))}
          </SelectField>
        </div>
        {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Adding…' : 'Add course'}
          </Button>
          <Button variant="secondary" onClick={() => onClose()}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RulesDialog({ open, view, onClose }: { open: boolean; view: ProgramNbaView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<AttainmentRules>(view.rules);
  useEffect(() => setRules(view.rules), [view.rules, open]);
  const save = useMutation({
    mutationFn: () => api(`/nba/programs/${view.program.id}/rules`, { method: 'PUT', body: rules }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['nba'] });
      onClose();
    },
  });
  const num = (label: string, current: number, set: (n: number) => void, step = '1') => (
    <Field label={label} type="number" step={step} inputMode="decimal" value={String(current)} onChange={(e) => set(Number(e.target.value))} />
  );
  return (
    <Dialog open={open} onClose={onClose} title="Attainment rules" description={`For ${view.program.name}. Changes apply to every course of the program.`}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3.5 sm:grid-cols-2">
          {num('Target mark (% of maximum)', rules.targetMarkPercent, (n) => setRules({ ...rules, targetMarkPercent: n }))}
          {num('CO target (of 3)', rules.coTarget, (n) => setRules({ ...rules, coTarget: n }), '0.1')}
          {num('Level 3: % of students', rules.levels.level3, (n) => setRules({ ...rules, levels: { ...rules.levels, level3: n } }))}
          {num('Level 2: % of students', rules.levels.level2, (n) => setRules({ ...rules, levels: { ...rules.levels, level2: n } }))}
          {num('Level 1: % of students', rules.levels.level1, (n) => setRules({ ...rules, levels: { ...rules.levels, level1: n } }))}
          {num('Internal weight (%)', rules.internalWeight, (n) => setRules({ ...rules, internalWeight: n, endExamWeight: 100 - n }))}
          {num('Direct weight (%)', rules.directWeight, (n) => setRules({ ...rules, directWeight: n, indirectWeight: 100 - n }))}
        </div>
        <p className="text-[13px] text-muted">
          End exam weight is {rules.endExamWeight}% and indirect weight {rules.indirectWeight}% (the rest of 100).
        </p>
        {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
        <div className="flex gap-3">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save rules'}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function PsoDialog({ open, view, onClose }: { open: boolean; view: ProgramNbaView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const initial = view.outcomes.filter((o) => o.kind === 'PSO').map((o) => ({ id: o.id as string | null, code: o.code, statement: o.statement }));
  const [psos, setPsos] = useState(initial);
  useEffect(() => setPsos(view.outcomes.filter((o) => o.kind === 'PSO').map((o) => ({ id: o.id as string | null, code: o.code, statement: o.statement }))), [view.outcomes, open]);
  const save = useMutation({
    mutationFn: () => api(`/nba/programs/${view.program.id}/psos`, { method: 'PUT', body: { psos } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['nba'] });
      onClose();
    },
  });
  return (
    <Dialog open={open} onClose={onClose} title="Program-specific outcomes" description="Up to six. Removing a PSO also removes its mapping in every course.">
      <div className="flex flex-col gap-3">
        {psos.map((pso, i) => (
          <div key={pso.id ?? `new-${i}`} className={cn('grid items-end gap-2 rounded-control bg-bg p-3 sm:grid-cols-[6rem_1fr_auto]')}>
            <Field label="Code" value={pso.code} onChange={(e) => setPsos(psos.map((p, j) => (j === i ? { ...p, code: e.target.value } : p)))} />
            <Field label="Statement" value={pso.statement} onChange={(e) => setPsos(psos.map((p, j) => (j === i ? { ...p, statement: e.target.value } : p)))} />
            <Button variant="ghost" className="text-red" onClick={() => setPsos(psos.filter((_, j) => j !== i))}>
              Remove<span className="sr-only"> {pso.code}</span>
            </Button>
          </div>
        ))}
        <Button variant="secondary" className="self-start" disabled={psos.length >= 6} onClick={() => setPsos([...psos, { id: null, code: `PSO${psos.length + 1}`, statement: '' }])}>
          Add a PSO
        </Button>
        {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
        <div className="flex gap-3">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save PSOs'}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ProfileDialog({ open, view, onClose }: { open: boolean; view: ProgramNbaView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [vision, setVision] = useState(view.profile.vision);
  const [mission, setMission] = useState(view.profile.mission);
  const [peos, setPeos] = useState(view.profile.peos);
  useEffect(() => {
    setVision(view.profile.vision);
    setMission(view.profile.mission);
    setPeos(view.profile.peos);
  }, [view.profile, open]);
  const save = useMutation({
    mutationFn: () => api(`/nba/programs/${view.program.id}/profile`, { method: 'PUT', body: { vision, mission, peos } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['nba'] });
      onClose();
    },
  });
  const area = 'w-full rounded-control border border-border bg-surface px-3.5 py-2.5 text-[15px]';
  return (
    <Dialog open={open} onClose={onClose} title="Vision, mission and PEOs" description={`For ${view.program.name}. Used in criterion 1 of the SAR.`}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
          Vision
          <textarea rows={2} maxLength={2000} className={area} value={vision} onChange={(e) => setVision(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
          Mission
          <textarea rows={3} maxLength={3000} className={area} value={mission} onChange={(e) => setMission(e.target.value)} />
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-muted">Program educational objectives</legend>
          {peos.map((peo, i) => (
            <div key={`${peo.code}-${i}`} className="grid items-end gap-2 rounded-control bg-bg p-3 sm:grid-cols-[6rem_1fr_auto]">
              <Field label="Code" value={peo.code} onChange={(e) => setPeos(peos.map((p, j) => (j === i ? { ...p, code: e.target.value } : p)))} />
              <Field label="Objective" value={peo.statement} onChange={(e) => setPeos(peos.map((p, j) => (j === i ? { ...p, statement: e.target.value } : p)))} />
              <Button variant="ghost" className="text-red" onClick={() => setPeos(peos.filter((_, j) => j !== i))}>
                Remove<span className="sr-only"> {peo.code}</span>
              </Button>
            </div>
          ))}
          <Button variant="secondary" className="self-start" disabled={peos.length >= 8} onClick={() => setPeos([...peos, { code: `PEO${peos.length + 1}`, statement: '' }])}>
            Add a PEO
          </Button>
        </fieldset>
        {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
        <div className="flex gap-3">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
