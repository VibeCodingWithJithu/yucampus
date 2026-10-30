'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DepartmentView,
  EvidenceLibraryPage,
  RegisterFieldView,
  RegisterPage,
  RegisterProof,
  RegisterRecordView,
  RegisterValue,
} from '@yucampus/types';
import { Button, Dialog, Field, Notice, SelectField, inputClasses } from '@yucampus/ui';
import { registerDataSchema } from '@yucampus/validation';
import { useDeferredValue, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { api, errorMessage } from '@/lib/api';

type Draft = Record<string, string>;

const toDraft = (field: RegisterFieldView, value: RegisterValue | undefined): string =>
  value === null || value === undefined ? '' : field.type === 'boolean' ? (value ? 'yes' : 'no') : String(value);

/** One input per configured field. The register's rules file decides which, in which order. */
function FieldInput({
  field,
  value,
  onChange,
  programs,
  error,
}: {
  field: RegisterFieldView;
  value: string;
  onChange: (value: string) => void;
  programs: RegisterPage['programs'];
  error?: string;
}) {
  const label = `${field.label}${field.unit ? ` (${field.unit})` : ''}${field.required ? '' : ' (optional)'}`;
  const common = { label, error, hint: field.help, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) };
  switch (field.type) {
    case 'choice':
      return (
        <SelectField {...common}>
          <option value="">Choose…</option>
          {field.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </SelectField>
      );
    case 'boolean':
      return (
        <SelectField {...common}>
          <option value="">Not stated</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </SelectField>
      );
    case 'program':
      return (
        <SelectField {...common}>
          <option value="">Choose…</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      );
    case 'longtext':
      return (
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted sm:col-span-2">
          {label}
          <textarea rows={3} maxLength={5000} className={`${inputClasses} h-auto py-2.5 font-normal text-ink`} value={value} onChange={(e) => onChange(e.target.value)} />
          {field.help ? <span className="font-normal">{field.help}</span> : null}
        </label>
      );
    default:
      return (
        <Field
          {...common}
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : 'text'}
          inputMode={field.type === 'number' ? (field.integer ? 'numeric' : 'decimal') : undefined}
          step={field.type === 'number' && !field.integer ? 'any' : undefined}
        />
      );
  }
}

/** Approved evidence to link as proof, searched in the evidence library. */
function ProofPicker({ value, onChange }: { value: RegisterProof[]; onChange: (value: RegisterProof[]) => void }) {
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const results = useQuery({
    queryKey: ['evidence', 'library', 'proof', term],
    queryFn: () => api<EvidenceLibraryPage>(`/evidence/library?status=approved&pageSize=8${term ? `&search=${encodeURIComponent(term)}` : ''}`),
    enabled: term.length >= 2,
  });
  return (
    <fieldset className="flex flex-col gap-2 sm:col-span-2">
      <legend className="mb-1.5 text-[13px] font-semibold text-muted">Proof (approved evidence)</legend>
      {value.length ? (
        <ul className="flex flex-col gap-1.5">
          {value.map((proof) => (
            <li key={proof.id} className="flex items-center justify-between gap-2 rounded-control bg-bg px-3 py-1.5 text-sm">
              <span className="min-w-0 truncate">{proof.title}</span>
              <Button variant="ghost" onClick={() => onChange(value.filter((p) => p.id !== proof.id))}>
                Remove<span className="sr-only"> {proof.title}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Field label="Find approved evidence" type="search" placeholder="Type at least two letters" value={search} onChange={(e) => setSearch(e.target.value)} />
      {results.data ? (
        results.data.items.length ? (
          <ul className="flex flex-col gap-1">
            {results.data.items
              .filter((item) => !value.some((p) => p.id === item.id))
              .map((item) => (
                <li key={item.id}>
                  <Button variant="secondary" className="w-full justify-start text-left" onClick={() => onChange([...value, { id: item.id, title: item.title }])}>
                    <span className="truncate">Add “{item.title}”</span>
                  </Button>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No approved evidence matches. Upload it first; it can be linked once approved.</p>
        )
      ) : null}
    </fieldset>
  );
}

export function RecordDialog({
  register,
  record,
  onClose,
}: {
  register: RegisterPage;
  record: RegisterRecordView | 'new' | null;
  onClose: (message?: string) => void;
}) {
  const open = record !== null;
  const existing = record === 'new' ? null : record;
  const readOnly = existing ? !existing.can.edit : false;
  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title={existing ? (readOnly ? existing.title : `Edit ${existing.title}`) : `Add to ${register.definition.name}`}
      description={readOnly ? 'You can read this record but not change it.' : undefined}
    >
      {open ? <RecordForm key={existing?.id ?? 'new'} register={register} record={existing} readOnly={readOnly} onDone={onClose} /> : null}
    </Dialog>
  );
}

function RecordForm({
  register,
  record,
  readOnly,
  onDone,
}: {
  register: RegisterPage;
  record: RegisterRecordView | null;
  readOnly: boolean;
  onDone: (message?: string) => void;
}) {
  const queryClient = useQueryClient();
  const { user, can, grants } = useAuth();
  const definition = register.definition;
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api<DepartmentView[]>('/departments') });
  const collegeWide = can('registers.edit', ['college']);
  const ownDepartments = grants.filter((g) => g.permission === 'registers.edit' && g.scope === 'department').map((g) => g.departmentId);
  const ownOnly = !collegeWide && ownDepartments.length === 0;
  const hasProgram = definition.fields.some((f) => f.type === 'program');

  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(definition.fields.map((f) => [f.key, toDraft(f, record?.data[f.key])])));
  const [departmentId, setDepartmentId] = useState(record?.department?.id ?? (ownDepartments[0] as string | undefined) ?? '');
  const [personId, setPersonId] = useState(record?.person?.id ?? (ownOnly ? (user?.id ?? '') : ''));
  const [proofs, setProofs] = useState<RegisterProof[]>(record?.proofs ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api<RegisterRecordView>(record ? `/registers/records/${record.id}` : `/registers/${definition.code}/records`, {
        method: record ? 'PUT' : 'POST',
        body: {
          academicYearId: register.year.id,
          departmentId: departmentId || null,
          userId: personId || null,
          data,
          proofIds: proofs.map((p) => p.id),
        },
      }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['registers'] });
      onDone(saved.missing.length ? `Saved “${saved.title}”. ${saved.missing.length} required ${saved.missing.length === 1 ? 'item is' : 'items are'} still missing.` : `Saved “${saved.title}”.`);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/registers/records/${record!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['registers'] });
      onDone(`Deleted “${record!.title}”.`);
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    // The same checks the API makes, so problems show next to the field straight away.
    const parsed = registerDataSchema(definition).safeParse(
      Object.fromEntries(definition.fields.map((f) => [f.key, f.type === 'boolean' ? (draft[f.key] === '' ? null : draft[f.key] === 'yes') : draft[f.key]])),
    );
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  const departmentChoices = collegeWide ? departments.data : departments.data?.filter((d) => ownDepartments.includes(d.id) || d.id === departmentId);

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <fieldset disabled={readOnly} className="grid gap-3.5 sm:grid-cols-2">
        {definition.department !== 'none' && !hasProgram ? (
          <SelectField label={definition.department === 'required' ? 'Department' : 'Department (optional)'} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">{definition.department === 'required' ? 'Choose…' : 'Whole college'}</option>
            {departmentChoices?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        {definition.person ? (
          <SelectField
            label={`${definition.person.label}${definition.person.required ? '' : ' (optional)'}`}
            hint={ownOnly ? 'Your own record.' : 'Linking lets this person update it.'}
            value={personId}
            disabled={ownOnly}
            onChange={(e) => setPersonId(e.target.value)}
          >
            <option value="">Not linked</option>
            {register.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        {definition.fields.map((field) => (
          <FieldInput
            key={field.key}
            field={field}
            value={draft[field.key] ?? ''}
            onChange={(value) => setDraft((d) => ({ ...d, [field.key]: value }))}
            programs={register.programs}
            error={errors[field.key]}
          />
        ))}
        {definition.proof !== 'none' ? (
          readOnly ? (
            <div className="sm:col-span-2">
              <p className="text-[13px] font-semibold text-muted">Proof</p>
              <p className="text-sm">{record?.proofs.map((p) => p.title).join(', ') || 'None linked'}</p>
            </div>
          ) : (
            <ProofPicker value={proofs} onChange={setProofs} />
          )
        ) : null}
      </fieldset>
      {save.isError || remove.isError ? <Notice tone="error">{errorMessage(save.error ?? remove.error)}</Notice> : null}
      {!readOnly ? (
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : record ? 'Save changes' : 'Add record'}
          </Button>
          <Button variant="secondary" onClick={() => onDone()}>
            Cancel
          </Button>
          {record ? (
            <Button
              variant="ghost"
              className="ml-auto text-red"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Delete “${record.title}”?`)) remove.mutate();
              }}
            >
              Delete
            </Button>
          ) : null}
        </div>
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => onDone()}>
          Close
        </Button>
      )}
    </form>
  );
}
