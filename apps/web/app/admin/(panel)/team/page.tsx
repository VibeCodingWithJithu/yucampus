'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformAdminView } from '@yucampus/types';
import { Button, Card, Dialog, Field, Notice, StatusPill, Table, Td, Th } from '@yucampus/ui';
import { type PlatformInviteInput, platformInviteSchema } from '@yucampus/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';
import { usePlatform } from '../../platform-provider';
import { ago } from '../format';

const STATUS = { active: ['good', 'Active'], invited: ['attention', 'Invited'], disabled: ['problem', 'Disabled'] } as const;

export default function TeamPage() {
  const { admin: me } = usePlatform();
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const team = useQuery({ queryKey: ['platform', 'admins'], queryFn: () => platformApi<PlatformAdminView[]>('/admins') });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'disabled' | 'enabled' | 'password-link' | 'reset-mfa' }) =>
      action === 'password-link' || action === 'reset-mfa'
        ? platformApi(`/admins/${id}/${action}`, { method: 'POST' })
        : platformApi(`/admins/${id}/${action}`, { method: 'PUT' }),
    onSuccess: (_result, { action }) => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'admins'] });
      setMessage(
        {
          'password-link': 'Password link emailed.',
          'reset-mfa': 'Authenticator reset. Their sessions have ended; they set it up again at their next sign-in.',
          disabled: 'Disabled. Their sessions have ended.',
          enabled: 'Enabled again.',
        }[action],
      );
    },
  });

  return (
    <>
      <PageHeader title="Team" description="People at YuCampus who can use this panel." actions={<Button onClick={() => setInviting(true)}>Invite a team member</Button>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {act.isError ? <Notice tone="error">{errorMessage(act.error)}</Notice> : null}
      {team.isError ? <Notice tone="error">{errorMessage(team.error)}</Notice> : null}
      {team.data ? (
        <Card aria-labelledby="team-h" className="flex min-w-0 flex-col gap-3">
          <h2 id="team-h" className="text-[17px] font-bold">
            {team.data.length} {team.data.length === 1 ? 'team member' : 'team members'}
          </h2>
          <Table aria-labelledby="team-h" className="min-w-[860px]">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Two-step sign-in</Th>
                <Th>Last sign-in</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {team.data.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <span className="font-semibold">{a.name}</span>
                    {a.id === me?.id ? <span className="text-xs text-muted"> (you)</span> : null}
                    <span className="block text-xs text-muted">{a.email}</span>
                  </Td>
                  <Td>
                    <StatusPill tone={STATUS[a.status][0]}>{STATUS[a.status][1]}</StatusPill>
                  </Td>
                  <Td className={a.mfa ? '' : 'text-muted'}>{a.mfa ? 'Set up' : 'At next sign-in'}</Td>
                  <Td className="text-secondary">{a.lastSignInAt ? ago(a.lastSignInAt) : 'Never'}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {a.id !== me?.id ? (
                      <>
                        {a.status !== 'disabled' ? (
                          <Button variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ id: a.id, action: 'password-link' })}>
                            {a.status === 'invited' ? 'Send invite again' : 'Send password link'}
                            <span className="sr-only"> to {a.name}</span>
                          </Button>
                        ) : null}
                        {a.mfa && a.status !== 'disabled' ? (
                          <Button
                            variant="ghost"
                            disabled={act.isPending}
                            onClick={() => {
                              if (window.confirm(`Reset ${a.name}'s authenticator? They are signed out and set it up again at their next sign-in. Do this only when you are sure it is really them asking.`)) {
                                act.mutate({ id: a.id, action: 'reset-mfa' });
                              }
                            }}
                          >
                            Reset authenticator<span className="sr-only"> of {a.name}</span>
                          </Button>
                        ) : null}
                        <Button variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ id: a.id, action: a.status === 'disabled' ? 'enabled' : 'disabled' })}>
                          {a.status === 'disabled' ? 'Enable' : 'Disable'}
                          <span className="sr-only"> {a.name}</span>
                        </Button>
                      </>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
      <InviteDialog
        open={inviting}
        onClose={(text) => {
          setInviting(false);
          if (text) setMessage(text);
        }}
      />
    </>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: (message?: string) => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, formState, reset } = useForm<PlatformInviteInput>({ resolver: zodResolver(platformInviteSchema) });
  const invite = useMutation({
    mutationFn: (values: PlatformInviteInput) => platformApi<PlatformAdminView>('/admins', { method: 'POST', body: values }),
    onSuccess: (admin) => {
      void queryClient.invalidateQueries({ queryKey: ['platform', 'admins'] });
      reset();
      onClose(`Invited ${admin.name}. They have been emailed a link to choose a password.`);
    },
  });
  return (
    <Dialog open={open} onClose={() => onClose()} title="Invite a team member" description="Only for people at YuCampus. They can see every college's profile and counts.">
      <form noValidate className="flex flex-col gap-4" onSubmit={handleSubmit((values) => invite.mutate(values))}>
        <Field label="Name" error={formState.errors.name?.message} {...register('name')} />
        <Field label="Email" type="email" error={formState.errors.email?.message} {...register('email')} />
        {invite.isError ? <Notice tone="error">{errorMessage(invite.error)}</Notice> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? 'Inviting…' : 'Invite'}
          </Button>
          <Button variant="secondary" onClick={() => onClose()}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
