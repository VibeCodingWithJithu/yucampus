'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformCollegeDetail } from '@yucampus/types';
import { Button, Card, Dialog, Field, Notice, SelectField, StatusPill, Table, Td, Th } from '@yucampus/ui';
import { PLANS } from '@yucampus/validation';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';
import { TYPE_LABELS, ago, bytes, when } from '../../format';

function Count({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1 p-4 sm:p-4">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[22px] font-bold tabular-nums">{value}</span>
    </Card>
  );
}

export default function CollegePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const college = useQuery({ queryKey: ['platform', 'college', id], queryFn: () => platformApi<PlatformCollegeDetail>(`/colleges/${id}`) });
  const saved = (next: PlatformCollegeDetail, text: string) => {
    queryClient.setQueryData(['platform', 'college', id], next);
    void queryClient.invalidateQueries({ queryKey: ['platform', 'colleges'] });
    setMessage(text);
  };
  const plan = useMutation({
    mutationFn: (value: string) => platformApi<PlatformCollegeDetail>(`/colleges/${id}/plan`, { method: 'PUT', body: { plan: value } }),
    onSuccess: (next) => saved(next, `Plan changed to ${next.plan}.`),
  });
  const resend = useMutation({
    mutationFn: () => platformApi<{ sent: number }>(`/colleges/${id}/resend-invite`, { method: 'POST' }),
    onSuccess: ({ sent }) => setMessage(`Invite sent again to ${sent === 1 ? 'the college admin' : `${sent} college admins`}.`),
  });

  if (college.isError) {
    return (
      <>
        <PageHeader breadcrumb={[{ label: 'Colleges', href: '/admin' }, { label: 'College' }]} title="College" />
        <Notice tone="error">{errorMessage(college.error)}</Notice>
      </>
    );
  }
  const c = college.data;
  if (!c) return <p className="text-sm text-muted">Loading…</p>;
  const suspended = c.status === 'suspended';

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Colleges', href: '/admin' }, { label: c.name }]}
        title={c.name}
        description={`${TYPE_LABELS[c.type]} · ${[c.city, c.state].filter(Boolean).join(', ')} · ${c.url}`}
        actions={
          <Button variant={suspended ? 'primary' : 'secondary'} onClick={() => setChanging(true)}>
            {suspended ? 'Reactivate' : 'Suspend'}
          </Button>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {suspended ? <Notice tone="error">Suspended: nobody at this college can sign in. Their data is kept.</Notice> : null}
      {plan.isError || resend.isError ? <Notice tone="error">{errorMessage(plan.error ?? resend.error)}</Notice> : null}

      <section aria-label="Counts" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Count label="People" value={c.users.toLocaleString('en-IN')} />
        <Count label="Active, 30 days" value={c.activeUsers.toLocaleString('en-IN')} />
        <Count label="Evidence items" value={c.evidence.toLocaleString('en-IN')} />
        <Count label="Storage" value={bytes(c.storageBytes)} />
        <Count label="Register records" value={c.registerRecords.toLocaleString('en-IN')} />
        <Count label="Last activity" value={c.lastActivityAt ? ago(c.lastActivityAt) : 'Never'} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card aria-labelledby="account-h" className="flex flex-col gap-4">
          <h2 id="account-h" className="text-[17px] font-bold">
            Account
          </h2>
          <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Status</dt>
            <dd>
              <StatusPill tone={suspended ? 'problem' : 'good'}>{suspended ? 'Suspended' : 'Active'}</StatusPill>
            </dd>
            <dt className="text-muted">Web address</dt>
            <dd className="break-all">{c.url}</dd>
            <dt className="text-muted">AISHE code</dt>
            <dd>{c.aisheCode ?? <span className="text-muted">Not entered</span>}</dd>
            <dt className="text-muted">Set up</dt>
            <dd>{when(c.createdAt)}</dd>
          </dl>
          <SelectField label="Plan" value={c.plan} disabled={plan.isPending} onChange={(e) => plan.mutate(e.target.value)} className="max-w-60">
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </SelectField>
          <p className="text-xs text-muted">The plan is a label for now; billing comes later.</p>
        </Card>

        <Card aria-labelledby="contacts-h" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="contacts-h" className="text-[17px] font-bold">
              Who to contact
            </h2>
            {c.contacts.some((p) => p.role === 'College admin' && p.status === 'invited') ? (
              <Button variant="secondary" disabled={resend.isPending} onClick={() => resend.mutate()}>
                Send the invite again
              </Button>
            ) : null}
          </div>
          {c.contacts.length === 0 ? (
            <p className="text-sm text-muted">No college admin or principal yet.</p>
          ) : (
            <ul className="flex flex-col">
              {c.contacts.map((p) => (
                <li key={`${p.name}-${p.role}`} className="border-b border-row py-2.5 text-sm last:border-b-0">
                  <span className="font-semibold">{p.name}</span> <span className="text-muted">· {p.role}</span>
                  {p.status === 'invited' ? <span className="text-xs font-semibold text-amber-strong"> · Not signed in yet</span> : null}
                  <span className="block text-secondary">{[p.email, p.mobile].filter(Boolean).join(' · ') || 'No contact details'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card aria-labelledby="frameworks-h" className="flex flex-col gap-3">
        <h2 id="frameworks-h" className="text-[17px] font-bold">
          Frameworks in use
        </h2>
        {c.frameworks.length === 0 ? (
          <p className="text-sm text-muted">None chosen yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {c.frameworks.map((f) => (
              <li key={f.code} className="rounded-full bg-primary-soft px-3 py-1 text-[13px] font-semibold text-primary">
                {f.name}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby="history-h" className="flex min-w-0 flex-col gap-3">
        <h2 id="history-h" className="text-[17px] font-bold">
          Team actions for this college
        </h2>
        {c.history.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <Table aria-labelledby="history-h" className="min-w-[560px]">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>What</Th>
              </tr>
            </thead>
            <tbody>
              {c.history.map((h) => (
                <tr key={h.id}>
                  <Td className="whitespace-nowrap text-secondary">{when(h.at)}</Td>
                  <Td>{h.admin?.name ?? 'Command line'}</Td>
                  <Td>
                    {h.actionLabel}
                    {typeof (h.detail.after as { reason?: string } | undefined)?.reason === 'string' ? (
                      <span className="text-secondary"> · {(h.detail.after as { reason: string }).reason}</span>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <StatusDialog college={c} open={changing} onClose={() => setChanging(false)} onSaved={saved} />
    </>
  );
}

function StatusDialog({
  college,
  open,
  onClose,
  onSaved,
}: {
  college: PlatformCollegeDetail;
  open: boolean;
  onClose: () => void;
  onSaved: (next: PlatformCollegeDetail, text: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const suspend = college.status === 'active';
  const change = useMutation({
    mutationFn: () => platformApi<PlatformCollegeDetail>(`/colleges/${college.id}/status`, { method: 'PUT', body: { status: suspend ? 'suspended' : 'active', reason } }),
    onSuccess: (next) => {
      setReason('');
      onClose();
      onSaved(next, suspend ? `${college.name} is suspended. Everyone there is signed out within 15 minutes.` : `${college.name} is active again.`);
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={suspend ? `Suspend ${college.name}?` : `Reactivate ${college.name}?`}
      description={
        suspend
          ? 'Nobody at the college can sign in, and everyone is signed out within 15 minutes. Nothing is deleted. The college sees this in its audit log.'
          : 'People at the college can sign in again. The college sees this in its audit log.'
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length < 5) {
            setError('Say why, in a few words');
            return;
          }
          setError(null);
          change.mutate();
        }}
      >
        <Field label="Reason" hint="Kept in both audit logs" value={reason} onChange={(e) => setReason(e.target.value)} error={error ?? undefined} />
        {change.isError ? <Notice tone="error">{errorMessage(change.error)}</Notice> : null}
        <div className="flex gap-3">
          <Button type="submit" variant={suspend ? 'danger' : 'primary'} disabled={change.isPending}>
            {change.isPending ? 'Saving…' : suspend ? 'Suspend' : 'Reactivate'}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
