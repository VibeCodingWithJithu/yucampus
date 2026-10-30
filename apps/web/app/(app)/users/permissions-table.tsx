'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CollegeRole,
  PERMISSIONS,
  PERMISSION_LABELS,
  type Permission,
  type PermissionAdjustment,
  ROLE_DISPLAY_ORDER,
  ROLE_LABELS,
  type Scope,
} from '@yucampus/types';
import { Card, Notice, Table, Td, Th } from '@yucampus/ui';
import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { api, errorMessage } from '@/lib/api';

interface PermissionCell {
  role: CollegeRole;
  permission: Permission;
  scope: Scope;
  defaultOn: boolean;
  allowed: boolean;
  adjusted: boolean;
  locked: boolean;
  editable: boolean;
}

const PERMISSIONS_KEY = ['permissions'];
const ROLES = ROLE_DISPLAY_ORDER.filter((role): role is CollegeRole => role !== 'super_admin');
const SHORT_ROLE: Record<CollegeRole, string> = {
  college_admin: 'College admin',
  principal: 'Principal',
  iqac: 'IQAC',
  hod: 'HOD',
  nba_coord: 'NBA coord.',
  nirf_coord: 'NIRF coord.',
  faculty: 'Faculty',
  office: 'Office',
};
const SCOPE_NOTE: Partial<Record<Scope, string>> = { department: 'Dept', own: 'Own', nba: 'NBA', nirf: 'NIRF' };

/** "What each role can do": every cell is the college's current setting; editable ones are checkboxes. */
export function PermissionsTable() {
  const queryClient = useQueryClient();
  const { reloadUser } = useAuth();
  const cells = useQuery({ queryKey: PERMISSIONS_KEY, queryFn: () => api<PermissionCell[]>('/permissions') });
  // Ticks show straight away (set during the click); the server's answer then replaces them, or they flip back.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const change = useMutation({
    mutationFn: (adjustment: PermissionAdjustment) =>
      api<PermissionCell[]>('/permissions', { method: 'PUT', body: adjustment }),
    onSuccess: (saved) => {
      queryClient.setQueryData(PERMISSIONS_KEY, saved);
      // The person's own permissions may have changed too (menus, buttons).
      void reloadUser();
    },
    onSettled: (_data, _error, { role, permission }) =>
      setPending(({ [`${role}:${permission}`]: _done, ...rest }) => rest),
  });
  const toggle = (role: CollegeRole, permission: Permission, allowed: boolean) => {
    setPending((current) => ({ ...current, [`${role}:${permission}`]: allowed }));
    change.mutate({ role, permission, allowed });
  };

  const byKey = new Map(cells.data?.map((cell) => [`${cell.role}:${cell.permission}`, cell]));
  const anyEditable = cells.data?.some((cell) => cell.editable);

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-[17px] font-bold">What each role can do</h2>
        <p className="mt-1 text-sm text-muted">
          {anyEditable
            ? 'These start from YuCampus defaults. Tick or untick to change them for your college; changes apply straight away.'
            : 'Your college admin can change these for your college.'}
        </p>
      </div>
      {cells.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
      {cells.isError ? <Notice tone="error">{errorMessage(cells.error)}</Notice> : null}
      {change.isError ? <Notice tone="error">{errorMessage(change.error)}</Notice> : null}
      {cells.data ? (
        <Table className="min-w-[900px]">
          <thead>
            <tr>
              <Th>Permission</Th>
              {ROLES.map((role) => (
                <Th key={role} className="text-center">
                  {SHORT_ROLE[role]}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((permission) => (
              <tr key={permission}>
                <Td className="font-semibold">{PERMISSION_LABELS[permission]}</Td>
                {ROLES.map((role) => {
                  const cell = byKey.get(`${role}:${permission}`);
                  if (!cell) {
                    return (
                      <Td key={role} className="text-center text-muted">
                        –<span className="sr-only"> Not available for {ROLE_LABELS[role]}</span>
                      </Td>
                    );
                  }
                  const note = SCOPE_NOTE[cell.scope];
                  return (
                    <Td key={role} className="text-center">
                      <label className="inline-flex min-h-11 min-w-11 cursor-pointer flex-col items-center justify-center gap-0.5 has-disabled:cursor-default">
                        <input
                          type="checkbox"
                          className="size-5 accent-primary"
                          checked={pending[`${role}:${permission}`] ?? cell.allowed}
                          disabled={!cell.editable || `${role}:${permission}` in pending}
                          onChange={(event) => toggle(role, permission, event.target.checked)}
                          aria-label={`${ROLE_LABELS[role]}: ${PERMISSION_LABELS[permission]}${note ? ` (${note})` : ''}`}
                        />
                        <span className="text-[11px] leading-none text-muted">
                          {cell.allowed ? (note ?? 'Yes') : 'No'}
                          {cell.adjusted ? ' · changed' : ''}
                          {cell.locked ? ' · fixed' : ''}
                        </span>
                      </label>
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      <p className="text-[13px] text-muted">
        Dept: own department only · Own: own items only · NBA / NIRF: that body only · Fixed: cannot be changed, so your
        college can never lock itself out. Only a college admin can add another college admin.
      </p>
    </Card>
  );
}
