'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COLLEGE_TYPES, type PlatformCollegeDetail, type PlatformCollegeRow } from '@yucampus/types';
import { Button, Card, Dialog, Field, Notice, SelectField, StatusPill, Table, Td, Th } from '@yucampus/ui';
import { type CreateCollegeInput, PLANS, createCollegeSchema } from '@yucampus/validation';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';
import { ROOT_DOMAIN } from '@/lib/tenant';
import { TYPE_LABELS, ago, bytes } from './format';

export default function CollegesPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const term = useDeferredValue(search.trim());
  const query = new URLSearchParams();
  if (term) query.set('search', term);
  if (status) query.set('status', status);
  const list = useQuery({ queryKey: ['platform', 'colleges', query.toString()], queryFn: () => platformApi<PlatformCollegeRow[]>(`/colleges?${query}`) });

  return (
    <>
      <PageHeader
        title="Colleges"
        description="Profile, status and counts only. The team panel never shows a college's evidence, records or answers."
        actions={<Button onClick={() => setAdding(true)}>Set up a college</Button>}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      <Card aria-label="Filters" className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-[1fr_200px] sm:py-4">
        <Field label="Search" placeholder="Name, address or state" value={search} onChange={(e) => setSearch(e.target.value)} />
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </SelectField>
      </Card>
      {list.isError ? <Notice tone="error">{errorMessage(list.error)}</Notice> : null}
      {list.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
      {list.data ? (
        <Card aria-labelledby="colleges-h" className="flex min-w-0 flex-col gap-3">
          <h2 id="colleges-h" className="text-[17px] font-bold">
            {list.data.length} {list.data.length === 1 ? 'college' : 'colleges'}
          </h2>
          {list.data.length === 0 ? (
            <p className="text-sm text-muted">No college matches.</p>
          ) : (
            <Table aria-labelledby="colleges-h" className="min-w-[860px]">
              <thead>
                <tr>
                  <Th>College</Th>
                  <Th>Plan</Th>
                  <Th>Status</Th>
                  <Th className="text-right">People</Th>
                  <Th className="text-right">Active, 30 days</Th>
                  <Th className="text-right">Evidence</Th>
                  <Th className="text-right">Storage</Th>
                  <Th>Last activity</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <Link href={`/admin/colleges/${c.id}`} className="font-semibold">
                        {c.name}
                      </Link>
                      <span className="block text-xs text-muted">
                        {c.subdomain} · {TYPE_LABELS[c.type]} · {c.state}
                      </span>
                    </Td>
                    <Td className="capitalize">{c.plan}</Td>
                    <Td>
                      <StatusPill tone={c.status === 'active' ? 'good' : 'problem'}>{c.status === 'active' ? 'Active' : 'Suspended'}</StatusPill>
                    </Td>
                    <Td className="text-right tabular-nums">{c.users.toLocaleString('en-IN')}</Td>
                    <Td className="text-right tabular-nums">{c.activeUsers.toLocaleString('en-IN')}</Td>
                    <Td className="text-right tabular-nums">{c.evidence.toLocaleString('en-IN')}</Td>
                    <Td className="text-right tabular-nums">{bytes(c.storageBytes)}</Td>
                    <Td className="text-secondary">{c.lastActivityAt ? ago(c.lastActivityAt) : 'Never'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}
      <CreateCollegeDialog
        open={adding}
        onClose={(text) => {
          setAdding(false);
          if (text) setMessage(text);
        }}
      />
    </>
  );
}

function CreateCollegeDialog({ open, onClose }: { open: boolean; onClose: (message?: string) => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState, reset } = useForm<CreateCollegeInput>({
    resolver: zodResolver(createCollegeSchema),
    defaultValues: { type: 'affiliated', plan: 'trial' },
  });
  const create = useMutation({
    mutationFn: (values: CreateCollegeInput) => platformApi<PlatformCollegeDetail>('/colleges', { method: 'POST', body: values }),
    onSuccess: (college) => {
      void queryClient.invalidateQueries({ queryKey: ['platform'] });
      reset();
      onClose(`Set up ${college.name} at ${college.url}. ${college.contacts[0]?.name ?? 'The college admin'} has been emailed an invite.`);
    },
  });
  return (
    <Dialog
      open={open}
      onClose={() => onClose()}
      title="Set up a college"
      description="The college admin gets an email to choose a password. The college does the rest of the setup itself."
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={handleSubmit((values) => create.mutate(values))}>
        <Field label="College name" error={formState.errors.name?.message} {...register('name')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Type" error={formState.errors.type?.message} {...register('type')}>
            {COLLEGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </SelectField>
          <Field label="State" error={formState.errors.state?.message} {...register('state')} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Web address" hint={`e.g. srec for srec.${ROOT_DOMAIN}`} error={formState.errors.subdomain?.message} {...register('subdomain')} />
          <SelectField label="Plan" error={formState.errors.plan?.message} {...register('plan')}>
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </SelectField>
        </div>
        <Field label="College admin's name" error={formState.errors.adminName?.message} {...register('adminName')} />
        <Field label="College admin's email" type="email" error={formState.errors.adminEmail?.message} {...register('adminEmail')} />
        {create.isError ? <Notice tone="error">{errorMessage(create.error)}</Notice> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Setting up…' : 'Set up and invite'}
          </Button>
          <Button variant="secondary" onClick={() => onClose()}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
