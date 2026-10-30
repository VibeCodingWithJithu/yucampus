'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssessmentKind, CourseView, SurveySummary, SurveyView } from '@yucampus/types';
import { Button, Card, Field, Notice, SelectField, StatusPill, Table, Td, Th, cn } from '@yucampus/ui';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatYearLabel } from '@/lib/format';
import { SurveyResults, SurveyShare } from '@/components/survey-panels';
import { RulesSummary } from '../../nba-screen';

const STRENGTH = ['Not mapped', 'Low', 'Medium', 'High'];
const CELL = ['border border-border bg-surface text-muted', 'bg-[#E3E6F6] text-ink', 'bg-[#AEB5E3] text-ink', 'bg-primary text-white'];
const show = (v: number | null) => (v === null ? '–' : v.toFixed(2));

export function CourseScreen() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const course = useQuery({ queryKey: ['nba', 'course', id], queryFn: () => api<CourseView>(`/nba/courses/${id}`) });
  const [message, setMessage] = useState<string | null>(null);
  const lock = useMutation({
    mutationFn: (locked: boolean) => api<CourseView>(`/nba/courses/${id}/lock`, { method: 'PUT', body: { locked } }),
    onSuccess: (view) => {
      queryClient.setQueryData(['nba', 'course', id], view);
      void queryClient.invalidateQueries({ queryKey: ['nba', 'program'] });
      setMessage(view.status === 'locked' ? 'Locked. The course now counts for the program’s PO attainment.' : 'Unlocked. The teacher can change it again.');
    },
  });
  const data = course.data;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: 'NBA', href: data ? `/nba?program=${data.program.id}` : '/nba' },
          ...(data ? [{ label: data.program.name, href: `/nba?program=${data.program.id}` }, { label: data.code }] : []),
        ]}
        title={data ? `${data.code} · ${data.name}` : 'Course'}
        description={
          data
            ? `${formatYearLabel(data.academicYear.label)}${data.semester ? ` · semester ${data.semester}` : ''} · ${data.teacher ? `taught by ${data.teacher.name}` : 'no teacher assigned'}`
            : undefined
        }
        actions={
          data ? (
            <>
              {data.status === 'locked' ? <StatusPill tone="good">Locked</StatusPill> : <StatusPill tone="neutral">Draft</StatusPill>}
              {data.can.lock ? (
                <Button disabled={lock.isPending} onClick={() => lock.mutate(true)}>
                  Lock course
                </Button>
              ) : null}
              {data.can.unlock ? (
                <Button variant="secondary" disabled={lock.isPending} onClick={() => lock.mutate(false)}>
                  Unlock
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {lock.isError ? <Notice tone="error">{errorMessage(lock.error)}</Notice> : null}
      {course.isError ? <Notice tone="error">{errorMessage(course.error)}</Notice> : null}
      {data?.status === 'locked' ? (
        <Notice tone="info">
          Locked{data.lockedBy ? ` by ${data.lockedBy}` : ''}
          {data.lockedAt ? ` on ${formatDateTime(data.lockedAt)}` : ''}. Read only; it counts for the program.
        </Notice>
      ) : null}

      {data ? (
        <>
          <Summary course={data} />
          <Outcomes key={`co-${data.outcomes.map((o) => o.id).join()}`} course={data} />
          {data.outcomes.length ? <Matrix key={`map-${data.outcomes.map((o) => o.id).join()}`} course={data} /> : null}
          {data.outcomes.length ? <Results key={`res-${data.outcomes.map((o) => o.id + o.results.length).join()}`} course={data} /> : null}
          {data.outcomes.length && (data.can.edit || data.can.lock || data.can.unlock) ? <CourseExit course={data} /> : null}
        </>
      ) : null}
    </>
  );
}

/** Saves one part of the course (outcomes, mapping or results) and shows the recalculated course everywhere. */
function useCourseSave(id: string, path: 'outcomes' | 'mapping' | 'results') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api<CourseView>(`/nba/courses/${id}/${path}`, { method: 'PUT', body }),
    onSuccess: (view) => {
      queryClient.setQueryData(['nba', 'course', id], view);
      void queryClient.invalidateQueries({ queryKey: ['nba', 'program'] });
    },
  });
}

function Summary({ course }: { course: CourseView }) {
  const target = course.rules.coTarget;
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <section aria-label="Attainment summary" className="flex flex-col gap-3">
        {[
          { label: 'Direct attainment', note: `${course.rules.internalWeight}% internal + ${course.rules.endExamWeight}% end exam`, value: course.summary.direct },
          { label: 'Indirect attainment', note: 'Course exit survey', value: course.summary.indirect },
        ].map((card) => (
          <Card key={card.label} className="flex items-center justify-between gap-3 p-5 sm:p-5">
            <span className="flex flex-col gap-1">
              <span className="text-[13px] text-muted">{card.label}</span>
              <span className="text-xs text-muted">{card.note}</span>
            </span>
            <span className="text-[26px] font-bold tabular-nums">{show(card.value)}</span>
          </Card>
        ))}
        <div className="flex items-center justify-between gap-3 rounded-card bg-primary p-5 text-white">
          <span className="flex flex-col gap-1">
            <span className="text-[13px] text-on-primary-muted">Final CO attainment</span>
            <span className="text-xs text-on-primary-muted">
              {course.rules.directWeight}% direct + {course.rules.indirectWeight}% indirect · target {target}
            </span>
          </span>
          <span className="text-[26px] font-bold tabular-nums">{show(course.summary.final)}</span>
        </div>
      </section>
      <Card aria-labelledby="coa-h" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="coa-h" className="text-[17px] font-bold">
            Attainment by course outcome
          </h2>
          <span className="text-[13px] text-muted">The dashed line marks the target of {target} on a 3-point scale</span>
        </div>
        {course.outcomes.length === 0 ? <p className="text-sm text-muted">Add the course outcomes below to start.</p> : null}
        <ul className="flex flex-col gap-3">
          {course.outcomes.map((o) => {
            const a = o.attainment;
            return (
              <li key={o.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-3.5">
                  <span className="w-10 text-[13px] font-bold text-primary">{o.code}</span>
                  <div
                    role="img"
                    aria-label={`${o.code}: ${a.final === null ? 'not complete' : `${a.final} of 3, ${a.meetsTarget ? 'target met' : 'below target'}`}`}
                    className="relative h-3 flex-1 rounded-full bg-row"
                  >
                    {a.final !== null ? (
                      <div className={cn('h-3 rounded-full', a.meetsTarget ? 'bg-teal' : 'bg-amber-fill')} style={{ width: `${(a.final / 3) * 100}%` }} />
                    ) : null}
                    <div className="absolute -top-1 -bottom-1 border-l-2 border-dashed border-ink" style={{ left: `${(target / 3) * 100}%` }} />
                  </div>
                  <span className="w-12 text-right text-sm font-bold tabular-nums">{show(a.final)}</span>
                  {a.meetsTarget === null ? null : a.meetsTarget ? <StatusPill tone="good">Target met</StatusPill> : <StatusPill tone="attention">Below target</StatusPill>}
                </div>
                <p className="pl-[3.375rem] text-xs text-muted">
                  {a.internalPercent !== null ? `Internal ${a.internalPercent}% → level ${a.internalLevel}` : 'Internal: no results'}
                  {' · '}
                  {a.endExamPercent !== null ? `End exam ${a.endExamPercent}% → level ${a.endExamLevel}` : 'End exam: no results'}
                  {a.direct !== null ? ` · direct ${show(a.direct)}` : ''}
                  {a.indirect !== null ? ` · indirect ${show(a.indirect)}` : ''}
                  {a.waitingFor ? ` · waiting for ${a.waitingFor}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
        <details>
          <summary className="cursor-pointer text-sm font-semibold">How this is worked out</summary>
          <div className="mt-2">
            <RulesSummary rules={course.rules} />
          </div>
        </details>
      </Card>
    </div>
  );
}

function Outcomes({ course }: { course: CourseView }) {
  const save = useCourseSave(course.id, 'outcomes');
  const [rows, setRows] = useState(course.outcomes.map((o) => ({ id: o.id as string | null, code: o.code, statement: o.statement, indirect: o.indirectLevel === null ? '' : String(o.indirectLevel) })));
  const edit = course.can.edit;
  return (
    <Card aria-labelledby="cos-h" className="flex flex-col gap-3">
      <h2 id="cos-h" className="text-[17px] font-bold">
        Course outcomes
      </h2>
      <p className="text-[13px] text-muted">What students will be able to do. The indirect level is the course exit survey result (0–3) for each CO.</p>
      {rows.length === 0 && !edit ? <p className="text-sm text-muted">No course outcomes yet.</p> : null}
      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <li key={row.id ?? `new-${i}`} className="grid items-end gap-2 rounded-control bg-bg p-3 sm:grid-cols-[5.5rem_1fr_8rem_auto]">
            <Field label="Code" value={row.code} disabled={!edit} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, code: e.target.value } : r)))} />
            <Field label="Students will be able to…" value={row.statement} disabled={!edit} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, statement: e.target.value } : r)))} />
            <Field
              label="Indirect (0–3)"
              type="number"
              step="0.1"
              inputMode="decimal"
              value={row.indirect}
              disabled={!edit}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, indirect: e.target.value } : r)))}
            />
            {edit ? (
              <Button variant="ghost" className="text-red" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                Remove<span className="sr-only"> {row.code}</span>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {edit ? (
        <>
          <Button variant="secondary" className="self-start" disabled={rows.length >= 12} onClick={() => setRows([...rows, { id: null, code: `CO${rows.length + 1}`, statement: '', indirect: '' }])}>
            Add a CO
          </Button>
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          {save.isSuccess ? <Notice tone="success">Course outcomes saved.</Notice> : null}
          <Button
            className="self-start"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                outcomes: rows.map((r) => ({ id: r.id, code: r.code, statement: r.statement, indirectLevel: r.indirect === '' ? null : Number(r.indirect) })),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save course outcomes'}
          </Button>
        </>
      ) : null}
    </Card>
  );
}

function Matrix({ course }: { course: CourseView }) {
  const save = useCourseSave(course.id, 'mapping');
  const [cells, setCells] = useState<Record<string, number>>(() =>
    Object.fromEntries(course.outcomes.flatMap((o) => Object.entries(o.mapping).map(([po, s]) => [`${o.id}:${po}`, s]))),
  );
  const [dirty, setDirty] = useState(false);
  const edit = course.can.edit;
  const pos = course.programOutcomes;
  return (
    <Card aria-labelledby="map-h" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="map-h" className="text-[17px] font-bold">
            CO–PO mapping
          </h2>
          <p className="text-[13px] text-muted">{edit ? 'Select a cell to change its mapping strength.' : 'How strongly each CO supports each outcome.'}</p>
        </div>
        <div aria-label="Legend" className="flex flex-wrap items-center gap-3.5 text-[13px] text-muted">
          {[3, 2, 1, 0].map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={cn('size-[18px] rounded', CELL[s])} />
              {s ? `${s} ${STRENGTH[s]}` : STRENGTH[s]}
            </span>
          ))}
        </div>
      </div>
      {pos.length === 0 ? (
        <Notice tone="info">This program has no outcomes yet, so there is nothing to map to.</Notice>
      ) : (
        <Table aria-labelledby="map-h" className="min-w-[960px] border-separate border-spacing-1">
          <thead>
            <tr>
              <Th className="w-14">CO</Th>
              {pos.map((po) => (
                <Th key={po.id} className="px-0.5 text-center" title={po.statement}>
                  {po.code}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {course.outcomes.map((o) => (
              <tr key={o.id}>
                <th scope="row" className="px-2 text-left text-sm font-bold text-primary" title={o.statement}>
                  {o.code}
                </th>
                {pos.map((po) => {
                  const strength = cells[`${o.id}:${po.id}`] ?? 0;
                  return (
                    <td key={po.id} className="p-0">
                      <button
                        type="button"
                        disabled={!edit}
                        aria-label={`${o.code} to ${po.code}: ${STRENGTH[strength]}${edit ? '. Select to change.' : ''}`}
                        onClick={() => {
                          setCells({ ...cells, [`${o.id}:${po.id}`]: (strength + 1) % 4 });
                          setDirty(true);
                        }}
                        className={cn('h-11 w-full rounded-md text-sm font-bold', CELL[strength], edit ? 'cursor-pointer' : 'cursor-default')}
                      >
                        {strength || '–'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-2 pt-2 text-left text-sm font-bold">
                Avg
              </th>
              {pos.map((po) => {
                const values = course.outcomes.map((o) => cells[`${o.id}:${po.id}`] ?? 0).filter((v) => v > 0);
                return (
                  <td key={po.id} className="pt-2 text-center text-sm font-bold tabular-nums">
                    {values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : '–'}
                  </td>
                );
              })}
            </tr>
            <tr>
              <th scope="row" className="px-2 text-left text-xs font-semibold text-muted">
                Attained
              </th>
              {pos.map((po) => (
                <td key={po.id} className="text-center text-xs tabular-nums text-muted">
                  {show(course.poAttainment.find((p) => p.outcomeId === po.id)?.value ?? null)}
                </td>
              ))}
            </tr>
          </tbody>
        </Table>
      )}
      {edit && pos.length ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(
                {
                  cells: Object.entries(cells).map(([key, strength]) => {
                    const [courseOutcomeId, programOutcomeId] = key.split(':') as [string, string];
                    return { courseOutcomeId, programOutcomeId, strength };
                  }),
                },
                { onSuccess: () => setDirty(false) },
              )
            }
          >
            {save.isPending ? 'Saving…' : 'Save mapping'}
          </Button>
          {dirty ? <span className="text-[13px] text-amber-strong">Unsaved changes</span> : save.isSuccess ? <span className="text-[13px] text-teal-strong">Saved</span> : null}
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
        </div>
      ) : null}
    </Card>
  );
}

interface ResultRow {
  courseOutcomeId: string;
  kind: AssessmentKind;
  name: string;
  attempted: string;
  reached: string;
}

function Results({ course }: { course: CourseView }) {
  const save = useCourseSave(course.id, 'results');
  const [rows, setRows] = useState<ResultRow[]>(() =>
    course.outcomes.flatMap((o) => o.results.map((r) => ({ courseOutcomeId: o.id, kind: r.kind, name: r.name, attempted: String(r.attempted), reached: String(r.reached) }))),
  );
  // "Saved" shows only until the next change.
  const [edited, setEdited] = useState(false);
  const edit = course.can.edit;
  const change = (next: ResultRow[]) => {
    setRows(next);
    setEdited(true);
  };
  const update = (i: number, patch: Partial<ResultRow>) => change(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Card aria-labelledby="res-h" className="flex min-w-0 flex-col gap-3">
      <h2 id="res-h" className="text-[17px] font-bold">
        Assessment results (totals per CO)
      </h2>
      <p className="text-[13px] text-muted">
        For each assessment: how many students attempted the questions for the CO, and how many reached {course.rules.targetMarkPercent}% of the marks. Only totals; no student's marks are stored.
      </p>
      {rows.length === 0 ? <p className="text-sm text-muted">No results entered yet.</p> : null}
      {rows.length ? (
        <Table aria-labelledby="res-h" className="min-w-[760px]">
          <thead>
            <tr>
              <Th>CO</Th>
              <Th>Assessment</Th>
              <Th>Name</Th>
              <Th>Attempted</Th>
              <Th>Reached target</Th>
              <Th className="text-right">Share</Th>
              {edit ? <Th><span className="sr-only">Remove</span></Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const share = Number(row.attempted) > 0 ? Math.round((Number(row.reached) / Number(row.attempted)) * 1000) / 10 : null;
              return (
                <tr key={`${row.courseOutcomeId}-${i}`}>
                  <Td>
                    <select aria-label={`Row ${i + 1} CO`} className="h-11 rounded-control border border-border bg-surface px-2" disabled={!edit} value={row.courseOutcomeId} onChange={(e) => update(i, { courseOutcomeId: e.target.value })}>
                      {course.outcomes.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.code}
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td>
                    <select aria-label={`Row ${i + 1} assessment`} className="h-11 rounded-control border border-border bg-surface px-2" disabled={!edit} value={row.kind} onChange={(e) => update(i, { kind: e.target.value as AssessmentKind })}>
                      <option value="internal">Internal</option>
                      <option value="end_exam">End exam</option>
                    </select>
                  </Td>
                  <Td>
                    <input aria-label={`Row ${i + 1} name`} className="h-11 w-44 rounded-control border border-border px-2" disabled={!edit} value={row.name} onChange={(e) => update(i, { name: e.target.value })} />
                  </Td>
                  <Td>
                    <input aria-label={`Row ${i + 1} attempted`} type="number" inputMode="numeric" className="h-11 w-24 rounded-control border border-border px-2" disabled={!edit} value={row.attempted} onChange={(e) => update(i, { attempted: e.target.value })} />
                  </Td>
                  <Td>
                    <input aria-label={`Row ${i + 1} reached target`} type="number" inputMode="numeric" className="h-11 w-24 rounded-control border border-border px-2" disabled={!edit} value={row.reached} onChange={(e) => update(i, { reached: e.target.value })} />
                  </Td>
                  <Td className="text-right tabular-nums">{share === null ? '–' : `${share}%`}</Td>
                  {edit ? (
                    <Td>
                      <Button variant="ghost" className="text-red" onClick={() => change(rows.filter((_, j) => j !== i))}>
                        Remove<span className="sr-only"> row {i + 1}</span>
                      </Button>
                    </Td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : null}
      {edit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => change([...rows, { courseOutcomeId: course.outcomes[0]!.id, kind: 'internal', name: 'Internal test 1', attempted: '', reached: '' }])}
          >
            Add a row
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { results: rows.map((r) => ({ courseOutcomeId: r.courseOutcomeId, kind: r.kind, name: r.name, attempted: Number(r.attempted), reached: Number(r.reached) })) },
                { onSuccess: () => setEdited(false) },
              )
            }
          >
            {save.isPending ? 'Saving…' : 'Save results'}
          </Button>
          {save.isSuccess && !edited ? <span className="text-[13px] text-teal-strong">Saved</span> : null}
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
        </div>
      ) : null}
    </Card>
  );
}

/** The course exit survey: one 1–3 question per CO. Closing it sets the COs' indirect attainment. */
function CourseExit({ course }: { course: CourseView }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['surveys', 'course', course.id], queryFn: () => api<SurveySummary[]>(`/surveys?course=${course.id}`) });
  const latest = list.data?.[0];
  const survey = useQuery({ queryKey: ['surveys', 'one', latest?.id], queryFn: () => api<SurveyView>(`/surveys/${latest!.id}`), enabled: Boolean(latest) });
  const start = useMutation({
    mutationFn: async () => {
      const created = await api<SurveyView>('/surveys', {
        method: 'POST',
        body: { templateCode: 'course_exit', title: `${course.code} course exit survey`, academicYearId: course.academicYear.id, courseId: course.id },
      });
      return api<SurveyView>(`/surveys/${created.id}/status`, { method: 'PUT', body: { status: 'open' } });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['surveys'] }),
  });
  return (
    <section aria-labelledby="exit-h" className="flex flex-col gap-3">
      <h2 id="exit-h" className="text-[17px] font-bold">
        Course exit survey
      </h2>
      {list.isError ? <Notice tone="error">{errorMessage(list.error)}</Notice> : null}
      {list.data && !latest ? (
        <Card className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">
            Students rate each CO from 1 to 3 through a link or QR code, without signing in. When you close the survey, each CO's average becomes its
            indirect attainment.
          </p>
          <Button disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? 'Starting…' : 'Start the course exit survey'}
          </Button>
          {start.isError ? <Notice tone="error">{errorMessage(start.error)}</Notice> : null}
        </Card>
      ) : null}
      {survey.data ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <SurveyShare survey={survey.data} />
          <SurveyResults survey={survey.data} />
        </div>
      ) : null}
    </section>
  );
}
