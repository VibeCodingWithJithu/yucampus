'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NirfSubParameterView, NirfView } from '@yucampus/types';
import { Button, Card, Dialog, Field, Notice, SelectField, Table, Td, Th, cn } from '@yucampus/ui';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ApiError, api, apiDownload, errorMessage } from '@/lib/api';
import { AssigneeSelect, toAssignee } from '../tasks/task-form';

const fill = (pct: number) => (pct >= 75 ? 'bg-teal' : pct >= 60 ? 'bg-primary' : 'bg-amber-fill');

function Bar({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-1.5 flex-1 overflow-hidden rounded-full bg-row">
      <div className={cn('h-full rounded-full', fill(percent))} style={{ width: `${percent}%` }} />
    </div>
  );
}

export function NirfScreen() {
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState('TLR');
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState<NirfSubParameterView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const view = useQuery({
    queryKey: ['nirf', category],
    queryFn: () => api<NirfView>(`/nirf${category ? `?category=${category}` : ''}`),
    retry: false,
  });
  const data = view.data;
  const parameter = data?.parameters.find((p) => p.key === selected) ?? data?.parameters[0];

  if (view.isError) {
    const noFramework = view.error instanceof ApiError && view.error.code === 'no_framework';
    return (
      <>
        <PageHeader breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'NIRF' }]} title="NIRF data readiness" />
        <Notice tone={noFramework ? 'info' : 'error'}>
          {errorMessage(view.error)} {noFramework ? <Link href="/setup">Open Institution setup</Link> : null}
        </Notice>
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'NIRF' }]}
        title="NIRF data readiness"
        description={data ? `${data.category.name.replace(/^NIRF · /, '')} category · data for the last ${data.years.length === 1 ? 'academic year' : `${data.years.length} academic years`}` : undefined}
        actions={
          data ? (
            <>
              {data.categories.length > 1 ? (
                <SelectField label="Category" value={data.category.code} onChange={(e) => setCategory(e.target.value)} className="w-48">
                  {data.categories.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name.replace(/^NIRF · /, '')}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  setExportError(null);
                  apiDownload(`/nirf/sheet?category=${data.category.code}`, 'nirf.xlsx').catch((e: unknown) => setExportError(errorMessage(e)));
                }}
              >
                Export data sheets
              </Button>
            </>
          ) : undefined
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {exportError ? <Notice tone="error">{exportError}</Notice> : null}
      {view.isPending ? <p className="text-sm text-muted">Loading…</p> : null}

      {data ? (
        <>
          {!data.source.verified ? <p className="text-xs text-amber-strong">{data.source.title}</p> : null}
          <section aria-label="Data years" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {data.years.map((y) => (
              <Card key={y.label} className="flex flex-col gap-2.5 p-4 sm:p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold">{y.label}</span>
                  <span className="text-[22px] font-bold tabular-nums">{y.percent}%</span>
                </div>
                <Bar percent={y.percent} label={`${y.label} data entered`} />
              </Card>
            ))}
          </section>

          <section aria-label="Ranking parameters" className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
            {data.parameters.map((p) => {
              const chosen = p.key === parameter?.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => {
                    setSelected(p.key);
                    setOpen(null);
                  }}
                  className={cn(
                    'flex cursor-pointer flex-col gap-2 rounded-card bg-surface p-4 text-left',
                    chosen ? 'border-2 border-primary shadow-[0_0_0_3px_var(--color-primary-soft)]' : 'border border-border hover:border-primary',
                  )}
                >
                  <span className="flex w-full items-center justify-between">
                    <span className="text-[13px] font-bold text-primary">{p.key}</span>
                    {p.weight !== null ? <span className="text-xs text-muted">Weight {p.weight}%</span> : null}
                  </span>
                  <span className="text-[15px] font-bold">{p.name}</span>
                  {p.percent === null ? (
                    <span className="text-xs text-muted">Collected by NIRF</span>
                  ) : (
                    <span className="flex w-full items-center gap-2">
                      <Bar percent={p.percent} label={`${p.name} data entered`} />
                      <span className="text-xs font-bold tabular-nums">{p.percent}%</span>
                    </span>
                  )}
                </button>
              );
            })}
          </section>

          {parameter ? (
            <Card aria-labelledby="sub-h" className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="sub-h" className="text-[17px] font-bold">
                  {parameter.name} · sub-parameters
                </h2>
                <span className="text-[13px] text-muted">Select a parameter card above to switch</span>
              </div>
              {parameter.note ? <Notice tone="info">{parameter.note}</Notice> : null}
              <Table aria-labelledby="sub-h" className="min-w-[680px]">
                <thead>
                  <tr>
                    <Th>Code</Th>
                    <Th>Sub-parameter</Th>
                    <Th>Data entered</Th>
                    <Th>Usually held by</Th>
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {parameter.subs.map((s) => (
                    <Fragment key={s.code}>
                      <tr>
                        <Td className="font-bold text-primary">{s.code}</Td>
                        <Td>{s.name}</Td>
                        <Td>
                          {s.percent === null ? (
                            <span className="text-[13px] text-muted">Not entered here</span>
                          ) : (
                            <div className="flex w-40 items-center gap-2">
                              <Bar percent={s.percent} label={`${s.name} data entered`} />
                              <span className="w-10 text-[13px] font-semibold tabular-nums">{s.percent}%</span>
                            </div>
                          )}
                        </Td>
                        <Td className="text-secondary">{s.owner}</Td>
                        <Td className="text-right whitespace-nowrap">
                          {s.items.length ? (
                            <>
                              <Button variant="ghost" aria-expanded={open === s.code} onClick={() => setOpen(open === s.code ? null : s.code)}>
                                {open === s.code ? 'Hide data' : 'Show data'}
                                <span className="sr-only"> for {s.name}</span>
                              </Button>
                              {data.can.assign ? (
                                <Button variant="ghost" onClick={() => setAsking(s)}>
                                  Ask someone<span className="sr-only"> for {s.name}</span>
                                </Button>
                              ) : null}
                            </>
                          ) : null}
                        </Td>
                      </tr>
                      {open === s.code ? (
                        <tr>
                          <td colSpan={5} className="bg-bg px-5 py-3 sm:px-6">
                            <table className="w-full text-[13px]">
                              <thead>
                                <tr className="text-left text-xs text-muted">
                                  <th className="py-1 pr-3 font-semibold">Data item</th>
                                  {data.years.map((y) => (
                                    <th key={y.label} className="py-1 pr-3 text-right font-semibold">
                                      {y.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {s.items.map((item) => (
                                  <tr key={item.key}>
                                    <td className="py-1 pr-3">
                                      {item.label}
                                      {item.unit ? <span className="text-muted"> ({item.unit})</span> : null}
                                    </td>
                                    {item.values.map((v, i) => (
                                      <td key={data.years[i]!.label} className={cn('py-1 pr-3 text-right tabular-nums', v === null && 'font-semibold text-red-strong')}>
                                        {v === null ? 'Not entered' : v.toLocaleString('en-IN')}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p className="mt-2 text-xs text-muted">
                              Entered in <Link href="/registers">Data registers</Link>.
                            </p>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}

          <AskDialog
            sub={asking}
            view={data}
            parameterKey={parameter?.key ?? ''}
            onClose={(text) => {
              setAsking(null);
              if (text) setMessage(text);
            }}
          />
        </>
      ) : null}
    </>
  );
}

/** Gives one sub-parameter's data collection to a person or department, as a task with a reminder. */
function AskDialog({ sub, view, parameterKey, onClose }: { sub: NirfSubParameterView | null; view: NirfView; parameterKey: string; onClose: (message?: string) => void }) {
  const queryClient = useQueryClient();
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10));
  const create = useMutation({
    mutationFn: () =>
      api('/tasks', {
        method: 'POST',
        body: {
          title: `NIRF ${parameterKey}-${sub!.code}: ${sub!.name} data, ${view.years.map((y) => y.label).join(', ')}`.slice(0, 200),
          description: `Please enter in Data registers: ${sub!.items.map((i) => i.label).join('; ')}.`,
          assignee: toAssignee(assignee),
          dueDate,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose(`Asked for ${sub!.code} data. It is on the Tasks page with reminders.`);
    },
  });
  return (
    <Dialog open={Boolean(sub)} onClose={() => onClose()} title={sub ? `Ask for ${sub.code} data` : 'Ask someone'} description={sub ? `${sub.name}. Usually held by: ${sub.owner}.` : undefined}>
      {sub ? (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (assignee) create.mutate();
          }}
        >
          <AssigneeSelect label="Who should enter it" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
          <Field label="By" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          {create.isError ? <Notice tone="error">{errorMessage(create.error)}</Notice> : null}
          <div className="flex gap-3">
            <Button type="submit" disabled={!assignee || create.isPending}>
              {create.isPending ? 'Creating…' : 'Create task'}
            </Button>
            <Button variant="secondary" onClick={() => onClose()}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
