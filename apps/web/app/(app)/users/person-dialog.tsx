'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CAN_GRANT_COLLEGE_ADMIN,
  type DepartmentView,
  ROLE_LABELS,
  ROLE_DISPLAY_ORDER,
  type UserView,
  departmentsFor,
  hasAnyRole,
} from '@yucampus/types';
import { Button, Dialog, Field, Notice, SelectField } from '@yucampus/ui';
import { ASSIGNABLE_ROLES, DEPARTMENT_ROLES, type UserInput, userInputSchema } from '@yucampus/validation';
import { useFieldArray, useForm } from 'react-hook-form';
import { useAuth } from '@/components/auth-provider';
import { api, errorMessage } from '@/lib/api';

const ROLE_OPTIONS = ROLE_DISPLAY_ORDER.filter((role): role is (typeof ASSIGNABLE_ROLES)[number] =>
  (ASSIGNABLE_ROLES as readonly string[]).includes(role),
);

export function PersonDialog({ person, onClose }: { person: UserView | 'new' | null; onClose: () => void }) {
  const isNew = person === 'new';
  return (
    <Dialog
      open={person !== null}
      onClose={onClose}
      title={isNew ? 'Add a person' : `Edit ${person?.name ?? ''}`}
      description={
        isNew
          ? 'They can sign in with this email or mobile number. Their status shows Active after the first sign-in.'
          : undefined
      }
    >
      {person ? <PersonForm key={isNew ? 'new' : person.id} person={isNew ? null : person} onDone={onClose} /> : null}
    </Dialog>
  );
}

function PersonForm({ person, onDone }: { person: UserView | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { roles: myRoles, grants, can } = useAuth();
  const canGrantAdmin = hasAnyRole(myRoles, CAN_GRANT_COLLEGE_ADMIN);
  // A HOD manages only faculty of their own department(s).
  const ownDepartments = can('users_setup.manage', ['college']) ? null : departmentsFor(grants, 'users_setup.manage');
  const targetIsAdmin = person?.roles.some((assignment) => assignment.role === 'college_admin') ?? false;
  const readOnly = targetIsAdmin && !canGrantAdmin;

  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api<DepartmentView[]>('/departments') });
  const { register, control, handleSubmit, watch, formState } = useForm<UserInput>({
    resolver: zodResolver(userInputSchema),
    defaultValues: {
      name: person?.name ?? '',
      email: person?.email ?? '',
      mobile: person?.mobile ?? '',
      roles: person?.roles.map(({ role, departmentId }) => ({
        role: role as UserInput['roles'][number]['role'],
        departmentId,
      })) ?? [{ role: 'faculty', departmentId: ownDepartments?.[0] ?? null }],
    },
  });
  const roles = useFieldArray({ control, name: 'roles' });

  const save = useMutation({
    mutationFn: (values: UserInput) =>
      api<UserView>(person ? `/users/${person.id}` : '/users', { method: person ? 'PUT' : 'POST', body: values }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['departments'] });
      void queryClient.invalidateQueries({ queryKey: ['institution', 'setup-progress'] });
      onDone();
    },
  });

  const rolesError = formState.errors.roles?.message ?? formState.errors.roles?.root?.message;

  return (
    <form noValidate onSubmit={handleSubmit((values) => save.mutate(values))} className="flex flex-col gap-4">
      {readOnly ? <Notice tone="info">Only a college admin can edit another college admin.</Notice> : null}
      <fieldset disabled={readOnly} className="flex flex-col gap-4">
        <Field label="Full name" autoComplete="off" error={formState.errors.name?.message} {...register('name')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Email"
            type="email"
            autoComplete="off"
            error={formState.errors.email?.message}
            {...register('email')}
          />
          <Field
            label="Mobile number"
            type="tel"
            inputMode="numeric"
            prefix="+91"
            autoComplete="off"
            error={formState.errors.mobile?.message}
            {...register('mobile')}
          />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-[15px] font-bold">Roles</legend>
          {roles.fields.map((field, index) => {
            const role = watch(`roles.${index}.role`);
            const needsDepartment = DEPARTMENT_ROLES.includes(role);
            const options = ownDepartments
              ? (['faculty'] as const)
              : ROLE_OPTIONS.filter(
                  (option) => option !== 'college_admin' || canGrantAdmin || role === 'college_admin',
                );
            const departmentChoices = ownDepartments
              ? departments.data?.filter((d) => ownDepartments.includes(d.id))
              : departments.data;
            return (
              <div
                key={field.id}
                className="grid items-end gap-3 rounded-control bg-bg p-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <SelectField label={`Role ${index + 1}`} {...register(`roles.${index}.role`)}>
                  {options.map((option) => (
                    <option key={option} value={option}>
                      {ROLE_LABELS[option]}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label={needsDepartment ? 'Department' : 'Department (optional)'}
                  error={formState.errors.roles?.[index]?.departmentId?.message}
                  {...register(`roles.${index}.departmentId`, { setValueAs: (value) => value || null })}
                >
                  {ownDepartments ? null : <option value="">{needsDepartment ? 'Choose…' : 'Whole college'}</option>}
                  {departmentChoices?.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.code} · {department.name}
                    </option>
                  ))}
                </SelectField>
                <Button
                  variant="ghost"
                  className="text-red"
                  disabled={roles.fields.length === 1}
                  onClick={() => roles.remove(index)}
                >
                  Remove<span className="sr-only"> role {index + 1}</span>
                </Button>
              </div>
            );
          })}
          {rolesError ? (
            <p role="alert" className="text-[13px] text-red">
              {rolesError}
            </p>
          ) : null}
          <div>
            <Button
              variant="secondary"
              onClick={() => roles.append({ role: 'faculty', departmentId: ownDepartments?.[0] ?? null })}
              disabled={roles.fields.length >= 10}
            >
              Add another role
            </Button>
          </div>
        </fieldset>
      </fieldset>

      {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
      {!readOnly ? (
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : person ? 'Save changes' : 'Add person'}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      ) : null}
      {person ? (
        <p className="text-[13px] text-muted">
          Role changes reach the person within 15 minutes, or when they next sign in.
        </p>
      ) : null}
    </form>
  );
}
