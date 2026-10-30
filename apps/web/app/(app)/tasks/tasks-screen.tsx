'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AccreditationOverview,
  type GapTasksResult,
  TASK_STAGE_LABELS,
  type TaskBoard,
  type TaskStage,
  type TaskView,
} from '@yucampus/types';
import { Button, Card, Dialog, Field, Notice, SelectField, StatusPill, buttonClasses, cn } from '@yucampus/ui';
import { REMINDER_RULES, REPEAT_LABELS, TASK_REMINDERS } from '@yucampus/validation';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { formatDate, plural } from '@/lib/format';
import { AssigneeSelect, TaskForm, toAssignee } from './task-form';

const STAGES: TaskStage[] = ['to_do', 'in_progress', 'submitted', 'approved'];

function DueChip({ task }: { task: TaskView }) {
  if (task.stage === 'approved') return <StatusPill tone="good">Done</StatusPill>;
  if (task.overdue) return <StatusPill tone="problem">Overdue</StatusPill>;
  return <StatusPill tone="neutral">{formatDate(task.dueDate).replace(/ \d{4}$/, '')}</StatusPill>;
}

const tagOf = (task: TaskView) => (task.metric ? `${task.metric.body} ${task.metric.code}` : 'General');

export function TasksScreen() {
  const { can } = useAuth();
  const canAssign = can('tasks.assign');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get('task');
  const [message, setMessage] = useState<string | null>(null);
  const [gapsOpen, setGapsOpen] = useState(false);
  const queryClient = useQueryClient();

  const board = useQuery({ queryKey: ['tasks', 'board'], queryFn: () => api<TaskBoard>('/tasks') });
  const remind = useMutation({
    mutationFn: () => api<{ reminded: number }>('/tasks/remind-overdue', { method: 'POST' }),
    onSuccess: ({ reminded }) =>
      setMessage(reminded ? `Sent ${plural(reminded, 'reminder')}.` : 'Everyone has already been reminded today.'),
  });

  const open = (id: string | null) => router.replace(id ? `${pathname}?task=${id}` : pathname, { scroll: false });
  const tasks = board.data?.tasks ?? [];
  const opened = openId ? tasks.find((task) => task.id === openId) : undefined;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Tasks' }]}
        title="Tasks"
        description={
          canAssign
            ? 'Give work to departments and faculty. Reminders go out automatically.'
            : 'Work given to you. Upload the evidence for each task; it is done when approved.'
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}

      {canAssign ? (
        <>
          <section aria-labelledby="gaps-h" className="flex flex-col gap-3">
            <h2 id="gaps-h" className="text-[17px] font-bold">
              Start from what is missing
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
              <Card className="flex flex-col gap-2.5 p-4 sm:p-4">
                <span className="text-[15px] font-bold">NAAC missing documents</span>
                <span className="text-[13px] text-muted">
                  One task for every document a metric still needs, for a criterion or all of them.
                </span>
                <Button variant="secondary" className="mt-auto" onClick={() => setGapsOpen(true)}>
                  Create tasks for gaps
                </Button>
              </Card>
            </div>
          </section>

          <Card aria-labelledby="new-h" className="flex flex-col gap-4">
            <h2 id="new-h" className="text-[17px] font-bold">
              Create a task
            </h2>
            <TaskForm onDone={(task) => setMessage(`Created “${task.title}”. ${task.assignee.name} has been told.`)} />
          </Card>
        </>
      ) : null}

      {canAssign && board.data && board.data.overdue > 0 ? (
        <section
          aria-label="Overdue tasks"
          className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-red-soft px-5 py-3.5"
        >
          <span className="text-sm font-semibold text-red-strong">
            {board.data.overdue === 1 ? '1 task is overdue' : `${board.data.overdue} tasks are overdue`}
          </span>
          <Button variant="danger" onClick={() => remind.mutate()} disabled={remind.isPending}>
            {remind.isPending ? 'Sending…' : 'Remind everyone now'}
          </Button>
        </section>
      ) : null}
      {remind.isError ? <Notice tone="error">{errorMessage(remind.error)}</Notice> : null}

      <section aria-labelledby="board-h" className="flex flex-col gap-3">
        <h2 id="board-h" className="text-[17px] font-bold">
          {canAssign ? 'Task board' : 'My tasks'}
        </h2>
        {board.isError ? <Notice tone="error">{errorMessage(board.error)}</Notice> : null}
        {board.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
        {board.data && tasks.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">{canAssign ? 'No tasks yet. Create the first one above.' : 'Nothing to do right now.'}</p>
          </Card>
        ) : null}
        {tasks.length > 0 ? (
          <div className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            {STAGES.map((stage) => {
              const column = tasks.filter((task) => task.stage === stage);
              return (
                <section
                  key={stage}
                  aria-label={`${TASK_STAGE_LABELS[stage]}, ${plural(column.length, 'task')}`}
                  className="flex flex-col gap-2.5 rounded-card bg-track p-3"
                >
                  <div className="flex items-center justify-between px-1 py-0.5">
                    <h3 className="text-sm font-bold">{TASK_STAGE_LABELS[stage]}</h3>
                    <span className="text-xs font-bold text-muted" aria-hidden="true">
                      {column.length}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-2.5">
                    {column.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => open(task.id)}
                          className="flex w-full cursor-pointer flex-col gap-1.5 rounded-[10px] border border-border bg-surface p-3 text-left hover:border-primary"
                        >
                          <span className="text-[11px] font-bold tracking-[0.03em] text-primary">{tagOf(task)}</span>
                          <span className="text-sm leading-snug font-semibold">{task.title}</span>
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted">{task.assignee.name}</span>
                            <DueChip task={task} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : null}
      </section>

      <Dialog open={Boolean(opened)} onClose={() => open(null)} title={opened?.title ?? 'Task'}>
        {opened ? (
          <TaskDetail
            key={opened.id}
            task={opened}
            onChanged={(text) => setMessage(text)}
            onClose={() => open(null)}
            refresh={() => void queryClient.invalidateQueries({ queryKey: ['tasks'] })}
          />
        ) : null}
      </Dialog>
      {openId && board.data && !opened ? (
        <Notice tone="info">That task is no longer on your board. It may have been deleted or finished long ago.</Notice>
      ) : null}

      <Dialog
        open={gapsOpen}
        onClose={() => setGapsOpen(false)}
        title="Tasks for missing documents"
        description="Documents that already have an open task are skipped, so you can run this again safely."
      >
        {gapsOpen ? (
          <GapsForm
            onDone={(result) => {
              setGapsOpen(false);
              setMessage(
                result.created
                  ? `Created ${plural(result.created, 'task')}${result.skipped ? `; ${result.skipped} already had one` : ''}.`
                  : 'Every missing document already has an open task.',
              );
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function TaskDetail({
  task,
  onChanged,
  onClose,
  refresh,
}: {
  task: TaskView;
  onChanged: (message: string) => void;
  onClose: () => void;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const setDone = useMutation({
    mutationFn: (done: boolean) => api<TaskView>(`/tasks/${task.id}/done`, { method: 'PUT', body: { done } }),
    onSuccess: (saved) => {
      refresh();
      onChanged(saved.stage === 'approved' ? `Marked “${saved.title}” as done.` : `Opened “${saved.title}” again.`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/tasks/${task.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      onClose();
      onChanged(`Deleted “${task.title}”. Evidence uploaded for it is kept.`);
    },
  });

  if (editing) {
    return (
      <TaskForm
        task={task}
        onDone={(saved) => {
          setEditing(false);
          onChanged(`Saved “${saved.title}”.`);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Stage</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{TASK_STAGE_LABELS[task.stage]}</span>
          <DueChip task={task} />
        </dd>
        <dt className="text-muted">For</dt>
        <dd>{task.assignee.name}</dd>
        <dt className="text-muted">Due</dt>
        <dd>
          {formatDate(task.dueDate)}
          {task.repeat !== 'none' ? ` · ${REPEAT_LABELS[task.repeat]}` : ''}
        </dd>
        {task.metric ? (
          <>
            <dt className="text-muted">Linked to</dt>
            <dd>
              {task.metric.body === 'NAAC' ? (
                <Link href={`/naac/metrics/${task.metric.id}`}>
                  {task.metric.code} · {task.metric.name}
                </Link>
              ) : (
                `${task.metric.code} · ${task.metric.name}`
              )}
              {task.documentName ? <span className="block text-muted">{task.documentName}</span> : null}
            </dd>
          </>
        ) : null}
        <dt className="text-muted">Given by</dt>
        <dd>{task.createdBy}</dd>
      </dl>
      {task.description ? <p className="rounded-control bg-bg p-3 text-sm whitespace-pre-line">{task.description}</p> : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">Evidence for this task</h3>
        {task.evidence.length === 0 ? (
          <p className="text-sm text-muted">Nothing uploaded yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {task.evidence.map((item) => (
              <li key={item.id} className="text-sm">
                <Link href={`/evidence/${item.id}`}>{item.title}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {setDone.isError || remove.isError ? <Notice tone="error">{errorMessage(setDone.error ?? remove.error)}</Notice> : null}
      <div className="flex flex-wrap gap-3">
        {task.can.upload ? (
          <Link href={`/evidence/upload?task=${task.id}`} className={buttonClasses()}>
            Upload evidence
          </Link>
        ) : null}
        {task.can.edit ? (
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="secondary" disabled={setDone.isPending} onClick={() => setDone.mutate(task.stage !== 'approved')}>
              {task.stage === 'approved' ? 'Open again' : 'Mark as done'}
            </Button>
            <Button
              variant="ghost"
              className={cn('text-red')}
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Delete “${task.title}”? Evidence uploaded for it is kept.`)) remove.mutate();
              }}
            >
              Delete
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function GapsForm({ onDone }: { onDone: (result: GapTasksResult) => void }) {
  const overview = useQuery({
    queryKey: ['accreditation', 'NAAC', 'overview'],
    queryFn: () => api<AccreditationOverview>('/accreditation/NAAC/overview'),
    retry: false,
  });
  const [criterion, setCriterion] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [reminders, setReminders] = useState<(typeof TASK_REMINDERS)[number]>('three_days');
  const [problem, setProblem] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<GapTasksResult>('/tasks/from-gaps', {
        method: 'POST',
        body: {
          frameworkId: overview.data!.framework.id,
          criterionNumber: criterion ? Number(criterion) : null,
          assignee: toAssignee(assignee),
          dueDate,
          reminders,
        },
      }),
    onSuccess: onDone,
  });

  if (overview.isError) return <Notice tone="error">{errorMessage(overview.error)}</Notice>;
  if (overview.isPending) return <p className="text-sm text-muted">Loading…</p>;
  const criteria = overview.data.criteria.filter((c) => !c.pending);

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setProblem(null);
        if (!assignee) return setProblem('Choose who the tasks are for.');
        create.mutate();
      }}
    >
      <p className="text-sm text-muted">{overview.data.framework.name}</p>
      <SelectField label="Criterion" value={criterion} onChange={(event) => setCriterion(event.target.value)}>
        <option value="">All criteria</option>
        {criteria.map((c) => (
          <option key={c.number} value={c.number}>
            Criterion {c.number} · {c.name}
            {c.missing ? ` (${c.missing} missing)` : ''}
          </option>
        ))}
      </SelectField>
      <AssigneeSelect label="Assign to" value={assignee} onChange={(event) => setAssignee(event.target.value)} error={problem ?? undefined} />
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Due date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        <SelectField
          label="Reminders"
          value={reminders}
          onChange={(event) => setReminders(event.target.value as (typeof TASK_REMINDERS)[number])}
        >
          {TASK_REMINDERS.map((reminder) => (
            <option key={reminder} value={reminder}>
              {REMINDER_RULES[reminder].label}
            </option>
          ))}
        </SelectField>
      </div>
      {create.isError ? <Notice tone="error">{errorMessage(create.error)}</Notice> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create tasks and notify'}
        </Button>
      </div>
    </form>
  );
}
