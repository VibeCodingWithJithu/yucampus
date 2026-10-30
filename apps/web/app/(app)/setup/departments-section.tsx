'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DepartmentView, FrameworksView, Page, ProgramView, UserView } from '@yucampus/types';
import { Button, Card, Dialog, Field, Notice, SelectField, Table, Td, Th } from '@yucampus/ui';
import { PROGRAM_LEVELS, type ProgramInput, createDepartmentSchema, programSchema } from '@yucampus/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, errorMessage } from '@/lib/api';
import { plural } from '@/lib/format';
import { FRAMEWORKS_KEY } from './frameworks-section';
import { SETUP_PROGRESS_KEY } from './setup-steps';

export const DEPARTMENTS_KEY = ['departments'];

/** A good first guess at a program's level from its name; it can be changed afterwards. */
function guessLevel(name: string): ProgramInput['level'] {
  if (/^ph\.?\s?d/i.test(name)) return 'PhD';
  if (/diploma/i.test(name)) return 'Diploma';
  if (/^(m\.|m\s|mba|mca|m\.?tech|m\.?sc|m\.?com|m\.?pharm|pg)/i.test(name)) return 'PG';
  return 'UG';
}

export function DepartmentsSection() {
  const departments = useQuery({ queryKey: DEPARTMENTS_KEY, queryFn: () => api<DepartmentView[]>('/departments') });
  const [editing, setEditing] = useState<DepartmentView | null>(null);

  return (
    <Card id="departments" className="flex scroll-mt-8 flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-bold">Departments and programs</h2>
        {departments.data ? <span className="text-sm text-muted">{plural(departments.data.length, 'department')}</span> : null}
      </div>

      {departments.isPending ? <p className="text-sm text-muted">Loading departments…</p> : null}
      {departments.isError ? <Notice tone="error">{errorMessage(departments.error)}</Notice> : null}
      {departments.data?.length === 0 ? (
        <p className="text-sm text-secondary">No departments yet. Add your first one below.</p>
      ) : null}
      {departments.data?.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Department</Th>
              <Th>Code</Th>
              <Th>Head of department</Th>
              <Th>Programs</Th>
              <Th className="text-right">Faculty</Th>
              <Th>
                <span className="sr-only">Action</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {departments.data.map((department) => (
              <tr key={department.id}>
                <Td className="font-semibold">{department.name}</Td>
                <Td>
                  <span className="rounded-md bg-row px-2 py-1 text-xs font-semibold">{department.code}</span>
                </Td>
                <Td className={department.hod ? '' : 'text-amber'}>{department.hod?.name ?? 'Not chosen'}</Td>
                <Td className={department.programs.length ? 'text-secondary' : 'text-amber'}>
                  {department.programs
                    .map((program) => (program.framework ? `${program.name} (${program.framework.name.replace('NBA · ', 'NBA ')})` : program.name))
                    .join(', ') || 'None yet'}
                </Td>
                <Td className="text-right tabular-nums">{department.facultyCount}</Td>
                <Td className="text-right">
                  <Button variant="ghost" onClick={() => setEditing(department)} aria-label={`Edit ${department.name}`}>
                    Edit
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      <AddDepartmentForm />
      <EditDepartmentDialog department={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

const addFormSchema = z.object({
  name: createDepartmentSchema.shape.name,
  code: createDepartmentSchema.shape.code,
  programs: z.string().trim().max(500),
});

function AddDepartmentForm() {
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState, reset } = useForm({ resolver: zodResolver(addFormSchema) });
  const add = useMutation({
    mutationFn: (values: z.output<typeof addFormSchema>) =>
      api<DepartmentView>('/departments', {
        method: 'POST',
        body: {
          name: values.name,
          code: values.code,
          programs: values.programs
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean)
            .map((name) => ({ name, level: guessLevel(name) })),
        },
      }),
    onSuccess: () => {
      reset({ name: '', code: '', programs: '' });
      void queryClient.invalidateQueries({ queryKey: DEPARTMENTS_KEY });
      void queryClient.invalidateQueries({ queryKey: SETUP_PROGRESS_KEY });
    },
  });

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => add.mutate(values))}
      className="flex flex-col gap-4 border-t border-row pt-5"
      aria-labelledby="add-department-heading"
    >
      <h3 id="add-department-heading" className="text-[15px] font-bold">
        Add a department
      </h3>
      <div className="grid gap-4 md:grid-cols-[2fr_1fr_2fr]">
        <Field
          label="Department name"
          placeholder="e.g. Artificial Intelligence and Data Science"
          error={formState.errors.name?.message}
          {...register('name')}
        />
        <Field label="Short code" placeholder="e.g. AIDS" error={formState.errors.code?.message} {...register('code')} />
        <Field
          label="Programs offered"
          placeholder="e.g. B.Tech, M.Tech"
          hint="Separate several with commas."
          error={formState.errors.programs?.message}
          {...register('programs')}
        />
      </div>
      {add.isError ? <Notice tone="error">{errorMessage(add.error)}</Notice> : null}
      {add.isSuccess ? <Notice tone="success">Department added.</Notice> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add department'}
        </Button>
        <span className="text-[13px] text-muted">You can choose the head of department after adding people.</span>
      </div>
    </form>
  );
}

function EditDepartmentDialog({ department, onClose }: { department: DepartmentView | null; onClose: () => void }) {
  return (
    <Dialog open={department !== null} onClose={onClose} title={department ? `Edit ${department.code}` : 'Edit department'}>
      {department ? <EditDepartmentForm key={department.id} department={department} onDone={onClose} /> : null}
    </Dialog>
  );
}

const editFormSchema = z.object({
  name: createDepartmentSchema.shape.name,
  code: createDepartmentSchema.shape.code,
  hodUserId: z.string(),
});

function EditDepartmentForm({ department, onDone }: { department: DepartmentView; onDone: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: DEPARTMENTS_KEY });
    void queryClient.invalidateQueries({ queryKey: SETUP_PROGRESS_KEY });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };
  const people = useQuery({
    queryKey: ['users', { departmentId: department.id }],
    queryFn: () => api<Page<UserView>>(`/users?pageSize=50&departmentId=${department.id}`),
  });
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(editFormSchema),
    defaultValues: { name: department.name, code: department.code, hodUserId: department.hod?.id ?? '' },
  });

  const save = useMutation({
    mutationFn: (values: z.output<typeof editFormSchema>) =>
      api(`/departments/${department.id}`, { method: 'PUT', body: { ...values, hodUserId: values.hodUserId || null } }),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/departments/${department.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });

  // The current head stays selectable even if they are not (or no longer) faculty in this department.
  const candidates = [...(people.data?.items ?? [])];
  if (department.hod && !candidates.some((person) => person.id === department.hod!.id)) {
    candidates.unshift({ ...department.hod, email: null, mobile: null, status: 'active', roles: [], lastLoginAt: null });
  }

  return (
    <div className="flex flex-col gap-6">
      <form noValidate onSubmit={handleSubmit((values) => save.mutate(values))} className="flex flex-col gap-4">
        <Field label="Department name" error={formState.errors.name?.message} {...register('name')} />
        <Field label="Short code" error={formState.errors.code?.message} {...register('code')} />
        <SelectField
          label="Head of department"
          hint={people.data && candidates.length === 0 ? 'Add people to this department in Users and roles first.' : 'People in this department.'}
          {...register('hodUserId')}
        >
          <option value="">Not chosen</option>
          {candidates.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </SelectField>
        {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save department'}
          </Button>
        </div>
      </form>

      <ProgramsEditor department={department} onChange={refresh} />

      <div className="flex flex-col gap-2 border-t border-row pt-5">
        <h3 className="text-[15px] font-bold">Remove department</h3>
        <p className="text-sm text-muted">Only possible while no people, evidence or tasks belong to it.</p>
        {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
        <div>
          <Button
            variant="secondary"
            className="text-red"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Remove ${department.name}? This cannot be undone.`)) remove.mutate();
            }}
          >
            Remove {department.code}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProgramsEditor({ department, onChange }: { department: DepartmentView; onChange: () => void }) {
  const [programs, setPrograms] = useState(department.programs);
  const frameworks = useQuery({ queryKey: FRAMEWORKS_KEY, queryFn: () => api<FrameworksView>('/institution/frameworks') });
  const programFrameworks = frameworks.data?.options.filter((option) => option.attachesTo === 'program') ?? [];
  const { register, handleSubmit, formState, reset } = useForm({
    resolver: zodResolver(programSchema),
    defaultValues: { name: '', level: 'UG' as const },
  });
  const replace = (program: ProgramView) => setPrograms((list) => list.map((p) => (p.id === program.id ? program : p)));
  const add = useMutation({
    mutationFn: (values: ProgramInput) => api<ProgramView>(`/departments/${department.id}/programs`, { method: 'POST', body: values }),
    onSuccess: (program) => {
      setPrograms((list) => [...list, program]);
      reset({ name: '', level: 'UG' });
      onChange();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/programs/${id}`, { method: 'DELETE' }).then(() => id),
    onSuccess: (id) => {
      setPrograms((list) => list.filter((program) => program.id !== id));
      onChange();
    },
  });
  const setFramework = useMutation({
    mutationFn: ({ id, frameworkId }: { id: string; frameworkId: string | null }) =>
      api<ProgramView>(`/programs/${id}/framework`, { method: 'PUT', body: { frameworkId } }),
    onSuccess: (program) => {
      replace(program);
      onChange();
    },
  });

  return (
    <div className="flex flex-col gap-3 border-t border-row pt-5">
      <h3 className="text-[15px] font-bold">Programs</h3>
      {programs.length === 0 ? <p className="text-sm text-amber">No programs yet.</p> : null}
      <ul className="flex flex-col gap-2">
        {programs.map((program) => (
          <li key={program.id} className="flex flex-col gap-2 rounded-control bg-bg p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">
                <span className="font-semibold">{program.name}</span> <span className="text-muted">· {program.level}</span>
              </span>
              <Button variant="ghost" className="text-red" disabled={remove.isPending} onClick={() => remove.mutate(program.id)}>
                Remove<span className="sr-only"> {program.name}</span>
              </Button>
            </div>
            <SelectField
              label={`NBA format for ${program.name}`}
              value={program.framework?.id ?? ''}
              disabled={setFramework.isPending || !frameworks.data}
              onChange={(event) => setFramework.mutate({ id: program.id, frameworkId: event.target.value || null })}
            >
              <option value="">Not assessed by NBA</option>
              {programFrameworks.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </SelectField>
          </li>
        ))}
      </ul>
      {remove.isError ? <Notice tone="error">{errorMessage(remove.error)}</Notice> : null}
      {setFramework.isError ? <Notice tone="error">{errorMessage(setFramework.error)}</Notice> : null}
      <form noValidate onSubmit={handleSubmit((values) => add.mutate(values))} className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Program name" placeholder="e.g. M.Tech" error={formState.errors.name?.message} {...register('name')} />
        <SelectField label="Level" {...register('level')}>
          {PROGRAM_LEVELS.map((level) => (
            <option key={level}>{level}</option>
          ))}
        </SelectField>
        {add.isError ? <Notice tone="error" className="sm:col-span-2">{errorMessage(add.error)}</Notice> : null}
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" disabled={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add program'}
          </Button>
        </div>
      </form>
    </div>
  );
}
