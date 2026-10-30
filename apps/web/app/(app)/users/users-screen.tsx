'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type Page, type Role, type UserCounts, type UserStatus, type UserView } from '@yucampus/types';
import { Button, Card, Notice, StatusPill, type StatusTone, Table, Td, Th, cn } from '@yucampus/ui';
import { useDeferredValue, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { initials } from '@/lib/format';
import { ImportDialog } from './import-dialog';
import { PersonDialog } from './person-dialog';
import { PermissionsTable } from './permissions-table';

const PAGE_SIZE = 20;

const STATUS: Record<UserStatus, { label: string; tone: StatusTone }> = {
  active: { label: 'Active', tone: 'good' },
  invited: { label: 'Invited', tone: 'attention' },
  not_joined: { label: 'Not joined', tone: 'problem' },
};

const ROLE_FILTERS: (Role | 'all')[] = ['all', 'principal', 'iqac', 'hod', 'nba_coord', 'faculty', 'office'];
const FILTER_LABEL = (role: Role | 'all') => (role === 'all' ? 'All' : ROLE_LABELS[role]);

export function UsersScreen() {
  const { can } = useAuth();
  const managesPeople = can('users_setup.manage');
  const departmentOnly = managesPeople && !can('users_setup.manage', ['college']);
  const [page, setPage] = useState(1);
  const [role, setRole] = useState<Role | 'all'>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [editing, setEditing] = useState<UserView | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const resend = useMutation({
    mutationFn: (user: UserView) => api(`/users/${user.id}/invite`, { method: 'POST' }).then(() => user),
  });

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (role !== 'all') params.set('role', role);
  if (deferredSearch) params.set('search', deferredSearch);

  const users = useQuery({
    queryKey: ['users', { page, role, search: deferredSearch }],
    queryFn: () => api<Page<UserView> & { counts: UserCounts }>(`/users?${params}`),
    placeholderData: keepPreviousData,
    enabled: managesPeople,
  });
  const counts = users.data?.counts;
  const pages = users.data ? Math.max(1, Math.ceil(users.data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Institution setup', href: '/setup' }, { label: 'Users and roles' }]}
        title="Users and roles"
        description={
          departmentOnly
            ? 'Add and update faculty of your department.'
            : 'Add everyone once, and each person sees only what their role needs.'
        }
        actions={
          managesPeople ? (
            <>
              <Button variant="secondary" onClick={() => setImporting(true)}>
                Import from Excel
              </Button>
              <Button onClick={() => setEditing('new')}>Add a person</Button>
            </>
          ) : undefined
        }
      />

      {managesPeople ? (
        <>
          <section aria-label="User counts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Total users', value: counts?.total, color: 'text-ink' },
              { label: 'Active', value: counts?.active, color: 'text-teal' },
              { label: 'Invited, not signed in yet', value: counts?.invited, color: 'text-amber' },
              { label: 'Not joined', value: counts?.not_joined, color: 'text-red' },
            ].map((count) => (
              <Card key={count.label} className="flex flex-col gap-1 p-4 sm:p-5">
                <span className="text-[13px] text-muted">{count.label}</span>
                <span className={cn('text-[26px] font-bold tabular-nums', count.color)}>{count.value ?? '–'}</span>
              </Card>
            ))}
          </section>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[17px] font-bold">All users</h2>
              <input
                type="search"
                aria-label="Search users"
                placeholder="Search by name, email or mobile"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="h-11 w-full rounded-control border border-border bg-surface px-3.5 text-sm sm:w-72"
              />
            </div>
            <div role="group" aria-label="Filter by role" className="flex flex-wrap gap-2">
              {ROLE_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={role === filter}
                  onClick={() => {
                    setRole(filter);
                    setPage(1);
                  }}
                  className={cn(
                    'h-11 cursor-pointer rounded-full border px-4 text-[13px] font-semibold',
                    role === filter
                      ? 'border-primary bg-primary text-white'
                      : 'border-border bg-surface text-ink hover:bg-bg',
                  )}
                >
                  {FILTER_LABEL(filter)}
                </button>
              ))}
            </div>

            {users.isError ? <Notice tone="error">{errorMessage(users.error)}</Notice> : null}
            {resend.isSuccess ? (
              <Notice tone="success">Sent a new invite to {resend.data.name}. Their earlier link no longer works.</Notice>
            ) : null}
            {resend.isError ? <Notice tone="error">{errorMessage(resend.error)}</Notice> : null}
            {users.isPending ? <p className="text-sm text-muted">Loading people…</p> : null}
            {users.data && users.data.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-secondary">
                {deferredSearch || role !== 'all'
                  ? 'Nobody matches. Try another search or role.'
                  : 'No people yet. Add someone or import from Excel.'}
              </p>
            ) : null}

            {users.data?.items.length ? (
              <Table aria-busy={users.isFetching}>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Department</Th>
                    <Th>Status</Th>
                    <Th>
                      <span className="sr-only">Action</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.items.map((user) => (
                    <tr key={user.id}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            className="flex size-9 flex-none items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary"
                          >
                            {initials(user.name)}
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span className="font-semibold">{user.name}</span>
                            <span className="truncate text-xs text-muted">
                              {user.email ?? (user.mobile ? `+91 ${user.mobile}` : '')}
                            </span>
                          </span>
                        </div>
                      </Td>
                      <Td>{[...new Set(user.roles.map((assignment) => ROLE_LABELS[assignment.role]))].join(', ')}</Td>
                      <Td className="text-secondary">
                        {[...new Set(user.roles.map((assignment) => assignment.departmentCode).filter(Boolean))].join(
                          ', ',
                        ) || 'College-wide'}
                      </Td>
                      <Td>
                        <StatusPill tone={STATUS[user.status].tone}>{STATUS[user.status].label}</StatusPill>
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        {user.status !== 'active' && user.email ? (
                          <Button variant="ghost" disabled={resend.isPending} onClick={() => resend.mutate(user)}>
                            Send invite again<span className="sr-only"> to {user.name}</span>
                          </Button>
                        ) : null}
                        <Button variant="ghost" onClick={() => setEditing(user)}>
                          Edit<span className="sr-only"> {user.name}</span>
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}

            {users.data && users.data.total > PAGE_SIZE ? (
              <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted">
                  Page {page} of {pages} · {users.data.total} people
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={page >= pages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </Button>
                </div>
              </nav>
            ) : null}
          </Card>
        </>
      ) : null}

      <PermissionsTable />

      <PersonDialog person={editing} onClose={() => setEditing(null)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}
