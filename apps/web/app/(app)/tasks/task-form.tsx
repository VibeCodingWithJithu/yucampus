'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskAssignees, TaskView } from '@yucampus/types';
import { Button, Field, Notice, SelectField, type SelectFieldProps, inputClasses } from '@yucampus/ui';
import { REMINDER_RULES, REPEAT_LABELS, TASK_REMINDERS, TASK_REPEATS, type TaskInput, taskInputSchema } from '@yucampus/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { MetricPicker } from '@/components/metric-links';
import { api, errorMessage } from '@/lib/api';

// The form keeps the assignee as one "kind:id" value for the select; it is split before sending.
const formSchema = taskInputSchema.omit({ assignee: true, metricId: true, documentKey: true }).extend({
  assignee: z.string().regex(/^(user|department):/, 'Choose who it is for'),
});
type FormValues = z.input<typeof formSchema>;

export function useAssignees() {
  return useQuery({ queryKey: ['tasks', 'assignees'], queryFn: () => api<TaskAssignees>('/tasks/assignees'), staleTime: 60_000 });
}

/** The "Assign to" select: departments first ("All CSE faculty"), then people. */
export function AssigneeSelect({ error, ...props }: Omit<SelectFieldProps, 'children'>) {
  const assignees = useAssignees();
  return (
    <SelectField error={error} disabled={!assignees.data} {...props}>
      <option value="">Choose…</option>
      {assignees.data?.departments.length ? (
        <optgroup label="Departments">
          {assignees.data.departments.map((d) => (
            <option key={d.id} value={`department:${d.id}`}>
              All {d.code} faculty
            </option>
          ))}
        </optgroup>
      ) : null}
      {assignees.data?.people.length ? (
        <optgroup label="People">
          {assignees.data.people.map((p) => (
            <option key={p.id} value={`user:${p.id}`}>
              {p.name}
              {p.detail ? ` (${p.detail})` : ''}
            </option>
          ))}
        </optgroup>
      ) : null}
    </SelectField>
  );
}

export const toAssignee = (value: string) => {
  const [kind, id] = value.split(':') as ['user' | 'department', string];
  return { kind, id };
};

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Create a task, or change one. "Create and notify" tells the people it is for straight away. */
export function TaskForm({ task, onDone }: { task?: TaskView; onDone: (task: TaskView) => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState, reset } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: task?.title ?? '',
      description: task?.description ?? '',
      assignee: task ? `${task.assignee.kind}:${task.assignee.id}` : '',
      dueDate: task?.dueDate ?? inDays(14),
      repeat: task?.repeat ?? 'none',
      reminders: task?.reminders ?? 'three_days',
    },
  });
  // The metric link is a pair of selects with its own component, so it is kept beside the form.
  const [link, setLink] = useState({ metricId: task?.metric?.id ?? '', documentKey: task?.documentKey ?? null });

  const save = useMutation({
    mutationFn: (body: TaskInput) => api<TaskView>(task ? `/tasks/${task.id}` : '/tasks', { method: task ? 'PUT' : 'POST', body }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (!task) {
        reset();
        setLink({ metricId: '', documentKey: null });
      }
      onDone(saved);
    },
  });

  const submit = handleSubmit((values) =>
    save.mutate({
      ...values,
      assignee: toAssignee(values.assignee),
      metricId: link.metricId || null,
      documentKey: link.metricId ? link.documentKey : null,
    }),
  );

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid items-start gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        <Field
          label="What needs to be done"
          placeholder="e.g. Upload 2025 journal papers"
          error={formState.errors.title?.message}
          {...register('title')}
        />
        <AssigneeSelect label="Assign to" error={formState.errors.assignee?.message} {...register('assignee')} />
        <Field label="Due date" type="date" error={formState.errors.dueDate?.message} {...register('dueDate')} />
        <SelectField label="Repeat" {...register('repeat')}>
          {TASK_REPEATS.map((repeat) => (
            <option key={repeat} value={repeat}>
              {REPEAT_LABELS[repeat]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Reminders" {...register('reminders')}>
          {TASK_REMINDERS.map((reminder) => (
            <option key={reminder} value={reminder}>
              {REMINDER_RULES[reminder].label}
            </option>
          ))}
        </SelectField>
      </div>
      <MetricPicker
        label="Linked to (optional)"
        value={link}
        onChange={setLink}
      />
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
        Notes for them (optional)
        <textarea rows={2} maxLength={2000} className={`${inputClasses} h-auto py-2.5`} {...register('description')} />
      </label>
      {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : task ? 'Save changes' : 'Create and notify'}
        </Button>
      </div>
    </form>
  );
}
