'use client';

import { useQuery } from '@tanstack/react-query';
import { type DashboardView, ROLE_LABELS, canOpenSection } from '@yucampus/types';
import { Notice, SelectField, inputClasses } from '@yucampus/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { formatYearLabel } from '@/lib/format';
import { CollegeDashboard } from './college-dashboard';
import { DashboardHome } from './dashboard-home';

function greeting(hour: number) {
  if (hour < 12) return 'Good morning';
  return hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** Principal, IQAC and HODs see the college (or department) dashboard; everyone sees their own work below it. */
export function DashboardScreen() {
  const { user, roles, can, grants } = useAuth();
  const router = useRouter();
  const overview = can('dashboards.view', ['college', 'department']);
  const [yearId, setYearId] = useState('');
  const [search, setSearch] = useState('');
  const dashboard = useQuery({
    queryKey: ['dashboard', yearId],
    queryFn: () => api<DashboardView>(`/dashboard${yearId ? `?year=${yearId}` : ''}`),
    enabled: overview,
    placeholderData: (previous) => previous,
  });

  const role = roles[0] ? ` · ${ROLE_LABELS[roles[0]]}` : '';
  const eyebrow = user ? `${greeting(new Date().getHours())}, ${user.name}${role}` : undefined;
  const view = dashboard.data;

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={view?.scope === 'department' ? 'Department overview' : 'Accreditation overview'}
        actions={
          overview ? (
            <>
              {view && view.years.length > 1 ? (
                <SelectField
                  label="Academic year"
                  value={view.academicYear.id}
                  onChange={(event) => setYearId(event.target.value)}
                  className="w-36"
                >
                  {view.years.map((y) => (
                    <option key={y.id} value={y.id}>
                      {formatYearLabel(y.label)}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              <form
                role="search"
                className="self-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  router.push(`/evidence${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`);
                }}
              >
                <input
                  type="search"
                  aria-label="Search evidence"
                  placeholder="Search evidence…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className={`${inputClasses} w-64 max-w-full`}
                />
              </form>
            </>
          ) : undefined
        }
      />

      {overview ? (
        <>
          {dashboard.isError ? <Notice tone="error">{errorMessage(dashboard.error)}</Notice> : null}
          {dashboard.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
          {view ? <CollegeDashboard view={view} canReview={canOpenSection(grants, 'review')} /> : null}
          <DashboardHome heading="Your work" hideWhenEmpty />
        </>
      ) : (
        <DashboardHome />
      )}
    </>
  );
}
