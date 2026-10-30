'use client';

import type { DashboardActivityKind, DashboardView, ReadinessStatus } from '@yucampus/types';
import { Card, StatusPill, Table, Td, Th, cn } from '@yucampus/ui';
import Link from 'next/link';
import { ReadinessBar, ReadinessPill } from '@/components/readiness';
import { formatDateTime, formatYearLabel, plural } from '@/lib/format';

const RING: Record<ReadinessStatus, string> = {
  on_track: 'stroke-teal',
  in_progress: 'stroke-primary',
  needs_attention: 'stroke-amber-fill',
};

const DOT: Record<DashboardActivityKind, string> = {
  upload: 'bg-primary',
  approved: 'bg-teal',
  sent_back: 'bg-amber-fill',
  task: 'bg-muted',
};

const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });

function ReadinessRing({ percent, status }: { percent: number; status: ReadinessStatus }) {
  const length = 2 * Math.PI * 36;
  return (
    <svg width="84" height="84" viewBox="0 0 88 88" role="img" aria-label={`NAAC readiness ${percent} percent`} className="flex-none">
      <circle cx="44" cy="44" r="36" fill="none" strokeWidth="10" className="stroke-primary-soft" />
      {/* No arc at 0%: a round line end would still draw a dot. */}
      {percent > 0 ? (
        <circle
          cx="44"
          cy="44"
          r="36"
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(percent / 100) * length} ${length}`}
          transform="rotate(-90 44 44)"
          className={RING[status]}
        />
      ) : null}
      <text x="44" y="50" textAnchor="middle" fontSize="19" fontWeight="700" className="fill-ink">
        {percent}%
      </text>
    </svg>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: number; note: string; tone: 'good' | 'attention' | 'problem' | 'muted' }) {
  return (
    <Card className="flex flex-col gap-2 p-5 sm:p-5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[32px] leading-none font-bold tracking-[-0.02em] tabular-nums">{value.toLocaleString('en-IN')}</span>
      <span
        className={cn(
          'text-xs font-semibold',
          tone === 'good' && 'text-teal',
          tone === 'attention' && 'text-amber',
          tone === 'problem' && 'text-red',
          tone === 'muted' && 'text-muted',
        )}
      >
        {note}
      </span>
    </Card>
  );
}

/** Readiness, key numbers, deadlines, programs, departments and recent activity (design: Main.dc.html). */
export function CollegeDashboard({ view, canReview }: { view: DashboardView; canReview: boolean }) {
  const naac = view.naac;
  const year = formatYearLabel(view.academicYear.label);
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Key numbers" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex items-center gap-4 p-5 sm:p-5">
          {naac ? (
            <>
              <ReadinessRing percent={naac.percent} status={naac.status} />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[13px] text-muted">NAAC readiness</span>
                <ReadinessPill status={naac.status} />
                <span className={cn('text-xs font-semibold', naac.change && naac.change > 0 ? 'text-teal' : 'text-muted')}>
                  {naac.change === null
                    ? 'Counts once IQAC approves evidence'
                    : naac.change > 0
                      ? `Up ${naac.change}% in 30 days`
                      : naac.change < 0
                        ? `Down ${-naac.change}% in 30 days`
                        : 'No change in 30 days'}
                </span>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-muted">NAAC readiness</span>
              <span className="text-sm">No NAAC framework chosen yet.</span>
              <Link href="/setup" className="text-sm font-semibold">
                Choose one in setup
              </Link>
            </div>
          )}
        </Card>
        <Stat
          label={`Evidence uploaded in ${year}`}
          value={view.evidence.uploaded}
          note={view.evidence.thisWeek ? `+${view.evidence.thisWeek} this week` : 'None this week'}
          tone={view.evidence.thisWeek ? 'good' : 'muted'}
        />
        <Stat
          label="Waiting for review"
          value={view.review.pending}
          note={
            view.review.oldestDays === null
              ? 'Nothing waiting'
              : view.review.oldestDays === 0
                ? 'Oldest from today'
                : `Oldest waiting ${plural(view.review.oldestDays, 'day')}`
          }
          tone={view.review.oldestDays && view.review.oldestDays > 3 ? 'attention' : 'muted'}
        />
        <Stat
          label="Missing NAAC documents"
          value={naac?.missingDocuments ?? 0}
          note={naac ? `Across ${plural(naac.metricsWithGaps, 'metric')}` : 'No framework yet'}
          tone={naac?.missingDocuments ? 'problem' : 'good'}
        />
      </section>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card aria-labelledby="crit-h" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="crit-h" className="text-[17px] font-bold">
              NAAC criteria progress
            </h2>
            {naac ? (
              <Link href="/naac" className="text-sm font-semibold no-underline">
                View all criteria
              </Link>
            ) : null}
          </div>
          {naac ? (
            <>
              <p className="text-[13px] text-muted">
                {naac.frameworkName}
                {naac.verified ? '' : ' · not yet checked against the official manual'}
              </p>
              <ul className="flex flex-col gap-4">
                {naac.criteria.map((c) => (
                  <li key={c.number} className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                      <span className="rounded-md bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">C{c.number}</span>
                      <Link href={`/naac/criteria/${c.number}`} className="min-w-0 flex-1 text-sm text-ink no-underline hover:underline">
                        {c.name}
                      </Link>
                      <span className="text-sm font-bold tabular-nums">{c.pending ? '–' : `${c.percent}%`}</span>
                    </div>
                    {c.pending ? (
                      <p className="text-xs text-muted">Metrics not loaded yet</p>
                    ) : (
                      <ReadinessBar percent={c.percent} status={c.status} label={`Criterion ${c.number} readiness`} />
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">Choose a NAAC framework in Institution setup to see progress by criterion.</p>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card aria-labelledby="dl-h" className="flex flex-col gap-4">
            <h2 id="dl-h" className="text-[17px] font-bold">
              Upcoming deadlines
            </h2>
            {view.deadlines.length === 0 ? (
              <p className="text-sm text-muted">
                No key dates ahead. Add them in <Link href="/setup/academic-year">Academic year and calendar</Link>.
              </p>
            ) : (
              <ul className="flex flex-col gap-3.5">
                {view.deadlines.map((d) => {
                  const date = new Date(`${d.date}T00:00:00Z`);
                  return (
                    <li key={d.id} className="flex items-center gap-3.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex h-[52px] w-12 flex-none flex-col items-center justify-center rounded-[10px]',
                          d.daysLeft <= 14 ? 'bg-red-soft text-red' : d.daysLeft <= 45 ? 'bg-amber-soft text-amber' : 'bg-primary-soft text-primary',
                        )}
                      >
                        <span className="text-[17px] font-bold">{date.getUTCDate()}</span>
                        <span className="text-[11px] font-semibold uppercase">{MONTH.format(date)}</span>
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-semibold">{d.title}</span>
                        <span className="text-xs text-muted">
                          <span className="sr-only">{date.toISOString().slice(0, 10)}, </span>
                          {d.daysLeft === 0 ? 'Today' : `${plural(d.daysLeft, 'day')} left`}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card aria-labelledby="nba-h" className="flex flex-col gap-3.5">
            <h2 id="nba-h" className="text-[17px] font-bold">
              NBA programs
            </h2>
            {view.programs.length === 0 ? (
              <p className="text-sm text-muted">No programs yet.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {view.programs.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-sm">
                      {p.name}
                      <span className="text-muted"> · {p.departmentCode}</span>
                    </span>
                    <StatusPill tone="neutral" className="flex-none">
                      {p.nbaFormat ?? 'No NBA format'}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">NBA progress (CO–PO, SAR) comes in a later release. Formats are set in Institution setup.</p>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card aria-labelledby="dept-h" className="flex min-w-0 flex-col gap-4">
          <h2 id="dept-h" className="text-[17px] font-bold">
            Department progress · {year}
          </h2>
          {view.departments.length === 0 ? (
            <p className="text-sm text-muted">No departments yet.</p>
          ) : (
            <Table aria-labelledby="dept-h" className="min-w-[640px]">
              <thead>
                <tr>
                  <Th>Department</Th>
                  <Th>Uploaded</Th>
                  <Th>In review</Th>
                  <Th>Open tasks</Th>
                  <Th>Faculty yet to upload</Th>
                  <Th className="w-40">Tasks done</Th>
                </tr>
              </thead>
              <tbody>
                {view.departments.map((d) => (
                  <tr key={d.id}>
                    <Td className="font-semibold">
                      <abbr title={d.name} className="no-underline">
                        {d.code}
                      </abbr>
                    </Td>
                    <Td className="tabular-nums">{d.uploaded}</Td>
                    <Td className="tabular-nums">{d.inReview}</Td>
                    <Td className="tabular-nums">{d.openTasks}</Td>
                    <Td className="tabular-nums">
                      {d.faculty ? `${d.facultyYetToUpload} of ${d.faculty}` : '–'}
                    </Td>
                    <Td>
                      {d.tasksPercent === null ? (
                        <span className="text-[13px] text-muted">No tasks</span>
                      ) : (
                        <div className="flex items-center gap-2.5">
                          <div className="flex-1">
                            <ReadinessBar
                              percent={d.tasksPercent}
                              status={d.tasksPercent >= 75 ? 'on_track' : d.tasksPercent >= 40 ? 'in_progress' : 'needs_attention'}
                              label={`${d.code} tasks done`}
                            />
                          </div>
                          <span className="w-10 text-[13px] font-semibold tabular-nums">{d.tasksPercent}%</span>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card aria-labelledby="act-h" className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="act-h" className="text-[17px] font-bold">
              Recent activity
            </h2>
            {canReview ? (
              <Link href="/review" className="text-sm font-semibold no-underline">
                Review queue
              </Link>
            ) : null}
          </div>
          {view.activity.length === 0 ? (
            <p className="text-sm text-muted">Uploads, approvals and new tasks will show here.</p>
          ) : (
            <ul className="flex flex-col gap-3.5">
              {view.activity.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <span aria-hidden="true" className={cn('mt-1.5 size-2.5 flex-none rounded-full', DOT[a.kind])} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    {a.link ? (
                      <Link href={a.link} className="text-sm leading-snug break-words text-ink no-underline hover:underline">
                        {a.text}
                      </Link>
                    ) : (
                      <span className="text-sm leading-snug break-words">{a.text}</span>
                    )}
                    <span className="text-xs text-muted">{formatDateTime(a.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
