'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcademicYearView, ProgramNbaView, SurveySummary, SurveyTemplateView, SurveyView } from '@yucampus/types';
import { Button, Dialog, Field, Notice, SelectField, cn } from '@yucampus/ui';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { SurveyResults, SurveyShare, SurveyStatusPill } from '@/components/survey-panels';
import { api, errorMessage } from '@/lib/api';
import { formatYearLabel } from '@/lib/format';

export function SurveysScreen() {
  const surveys = useQuery({ queryKey: ['surveys', 'list'], queryFn: () => api<SurveySummary[]>('/surveys') });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const id = selected ?? surveys.data?.[0]?.id ?? null;
  const survey = useQuery({ queryKey: ['surveys', 'one', id], queryFn: () => api<SurveyView>(`/surveys/${id}`), enabled: Boolean(id) });

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Surveys' }]}
        title="Surveys and feedback"
        description="Collect feedback from students, alumni, employers and parents through a link or QR code. Answers are anonymous."
        actions={<Button onClick={() => setCreating(true)}>New survey</Button>}
      />
      {surveys.isError ? <Notice tone="error">{errorMessage(surveys.error)}</Notice> : null}

      <section aria-labelledby="list-h" className="flex flex-col gap-3">
        <h2 id="list-h" className="text-[17px] font-bold">
          Your surveys
        </h2>
        {surveys.data?.length === 0 ? <p className="text-sm text-muted">No surveys yet. Start one with “New survey”.</p> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
          {surveys.data?.map((s) => {
            const chosen = s.id === id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={chosen}
                onClick={() => setSelected(s.id)}
                className={cn(
                  'flex cursor-pointer flex-col gap-2 rounded-card bg-surface p-4 text-left',
                  chosen ? 'border-2 border-primary shadow-[0_0_0_3px_var(--color-primary-soft)]' : 'border border-border hover:border-primary',
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-[11px] font-bold tracking-[0.04em] text-primary uppercase">{s.course ? s.course.code : s.audience}</span>
                  <SurveyStatusPill status={s.status} />
                </span>
                <span className="text-[15px] font-bold">{s.title}</span>
                {s.rate !== null ? (
                  <span className="flex w-full items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-row">
                      <span className="block h-1.5 bg-primary" style={{ width: `${s.rate}%` }} />
                    </span>
                    <span className="text-xs font-bold tabular-nums">{s.rate}%</span>
                  </span>
                ) : null}
                <span className="text-xs text-muted">
                  {s.responses} {s.responses === 1 ? 'answer' : 'answers'}
                  {s.expected ? ` of ${s.expected}` : ''} · {s.template.name} · {s.academicYear}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {survey.isError ? <Notice tone="error">{errorMessage(survey.error)}</Notice> : null}
      {survey.data ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <SurveyShare survey={survey.data} />
          <SurveyResults survey={survey.data} />
        </div>
      ) : null}

      <NewSurveyDialog
        open={creating}
        onClose={(createdId) => {
          setCreating(false);
          if (createdId) setSelected(createdId);
        }}
      />
    </>
  );
}

function NewSurveyDialog({ open, onClose }: { open: boolean; onClose: (createdId?: string) => void }) {
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: ['surveys', 'templates'], queryFn: () => api<SurveyTemplateView[]>('/surveys/templates'), enabled: open });
  const years = useQuery({ queryKey: ['academic-years'], queryFn: () => api<AcademicYearView[]>('/academic-years'), enabled: open });
  const programs = useQuery({
    queryKey: ['nba', 'programs'],
    queryFn: () => api<{ id: string; name: string; departmentCode: string }[]>('/nba/programs'),
    enabled: open,
  });
  const [templateCode, setTemplateCode] = useState('student_satisfaction');
  const [title, setTitle] = useState('');
  const [yearId, setYearId] = useState('');
  const [programId, setProgramId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [expected, setExpected] = useState('');
  const [closesOn, setClosesOn] = useState('');
  useEffect(() => {
    if (!yearId && years.data) setYearId(years.data.find((y) => y.status === 'current')?.id ?? '');
  }, [yearId, years.data]);
  const template = templates.data?.find((t) => t.code === templateCode);
  const courses = useQuery({
    queryKey: ['nba', 'program', programId, yearId],
    queryFn: () => api<ProgramNbaView>(`/nba/programs/${programId}?year=${yearId}`),
    enabled: Boolean(template?.perCourse && programId && yearId),
  });
  const create = useMutation({
    mutationFn: () =>
      api<SurveyView>('/surveys', {
        method: 'POST',
        body: {
          templateCode,
          title: title || `${template?.name ?? 'Survey'} ${formatYearLabel(years.data?.find((y) => y.id === yearId)?.label ?? '')}`.trim(),
          academicYearId: yearId,
          courseId: template?.perCourse ? courseId || null : null,
          expectedResponses: expected ? Number(expected) : null,
          closesOn: closesOn || null,
        },
      }),
    onSuccess: (survey) => {
      void queryClient.invalidateQueries({ queryKey: ['surveys'] });
      setTitle('');
      onClose(survey.id);
    },
  });

  return (
    <Dialog open={open} onClose={() => onClose()} title="New survey" description="It starts as a draft: open it when you are ready to share the link.">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <SelectField label="Template" value={templateCode} onChange={(e) => setTemplateCode(e.target.value)}>
          {templates.data?.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name} ({t.audience})
            </option>
          ))}
        </SelectField>
        {template ? (
          <p className="text-[13px] text-muted">
            {template.description} Feeds {template.feeds.join(', ')}. Ratings on a 1–{template.scale} scale.
          </p>
        ) : null}
        <div className="grid gap-3.5 sm:grid-cols-2">
          <SelectField label="Academic year" value={yearId} onChange={(e) => setYearId(e.target.value)}>
            {years.data?.map((y) => (
              <option key={y.id} value={y.id}>
                {formatYearLabel(y.label)}
              </option>
            ))}
          </SelectField>
          <Field label="Title (optional)" value={title} placeholder={template ? `${template.name} …` : ''} onChange={(e) => setTitle(e.target.value)} />
          {template?.perCourse ? (
            <>
              <SelectField label="Program" value={programId} onChange={(e) => { setProgramId(e.target.value); setCourseId(''); }}>
                <option value="">Choose…</option>
                {programs.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.departmentCode})
                  </option>
                ))}
              </SelectField>
              <SelectField label="Course" value={courseId} disabled={!courses.data} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">Choose…</option>
                {courses.data?.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </SelectField>
            </>
          ) : null}
          <Field label="People expected to answer (optional)" type="number" inputMode="numeric" hint="For the response rate, e.g. the class strength." value={expected} onChange={(e) => setExpected(e.target.value)} />
          <Field label="Closes on (optional)" type="date" value={closesOn} onChange={(e) => setClosesOn(e.target.value)} />
        </div>
        {create.isError ? <Notice tone="error">{errorMessage(create.error)}</Notice> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={create.isPending || (Boolean(template?.perCourse) && !courseId)}>
            {create.isPending ? 'Creating…' : 'Create survey'}
          </Button>
          <Button variant="secondary" onClick={() => onClose()}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
