'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AisheBlockView, AisheFigureView, AisheView } from '@yucampus/types';
import { Button, Card, Dialog, Field, Notice, SelectField, StatusPill, Table, Td, Th, cn } from '@yucampus/ui';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ApiError, api, apiDownload, errorMessage } from '@/lib/api';
import { AssigneeSelect, toAssignee } from '../tasks/task-form';

type Portal = 'AISHE' | 'NIRF' | 'NAAC';
const PORTALS: Portal[] = ['AISHE', 'NIRF', 'NAAC'];
const fill = (pct: number) => (pct >= 75 ? 'bg-teal' : pct >= 60 ? 'bg-primary' : 'bg-amber-fill');
const show = (v: number | null, unit?: string) => (v === null ? null : `${v.toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`);

function Bar({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="h-1.5 flex-1 overflow-hidden rounded-full bg-row">
      <div className={cn('h-full rounded-full', fill(percent))} style={{ width: `${percent}%` }} />
    </div>
  );
}

/** "Of whom from other states" -> "Other states", for a narrow column heading. */
const columnLabel = (label: string) => {
  const short = label.replace(/^Of whom (with |from )?/i, '');
  return short.charAt(0).toUpperCase() + short.slice(1);
};

function NotEntered() {
  return <span className="font-semibold text-red-strong">Not entered</span>;
}

export function AisheScreen() {
  const [yearId, setYearId] = useState('');
  const [tab, setTab] = useState<'forms' | 'checks'>('forms');
  const [selected, setSelected] = useState('profile');
  const [asking, setAsking] = useState<AisheBlockView | null>(null);
  const [recording, setRecording] = useState<{ figure: AisheFigureView; portal: Portal } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const view = useQuery({
    queryKey: ['aishe', yearId],
    queryFn: () => api<AisheView>(`/aishe${yearId ? `?year=${yearId}` : ''}`),
    retry: false,
  });
  const data = view.data;
  const block = data?.blocks.find((b) => b.key === selected) ?? data?.blocks[0];

  if (view.isError) {
    const noYear = view.error instanceof ApiError && view.error.code === 'no_year';
    return (
      <>
        <PageHeader breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'AISHE' }]} title="AISHE data forms" />
        <Notice tone={noYear ? 'info' : 'error'}>
          {errorMessage(view.error)} {noYear ? <Link href="/setup">Open Institution setup</Link> : null}
        </Notice>
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'AISHE' }]}
        title="AISHE data forms"
        description={
          data
            ? `Survey year ${data.year.label}${data.previousYear ? `, with ${data.previousYear.label} alongside` : ''}. Figures from the Data registers, ready to type into the AISHE portal.`
            : undefined
        }
        actions={
          data ? (
            <>
              <SelectField label="Survey year" value={data.year.id} onChange={(e) => setYearId(e.target.value)} className="w-48">
                {data.years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.label}
                    {y.status === 'locked' ? ' (locked)' : y.status === 'current' ? ' (current)' : ''}
                  </option>
                ))}
              </SelectField>
              <Button
                variant="secondary"
                onClick={() => {
                  setExportError(null);
                  apiDownload(`/aishe/sheet?year=${data.year.id}`, 'aishe.xlsx').catch((e: unknown) => setExportError(errorMessage(e)));
                }}
              >
                Export data forms
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
          {!data.source.verified || !data.checksSource.verified ? (
            <p className="text-xs text-amber-strong">
              {!data.source.verified ? data.source.title : null} {!data.checksSource.verified ? data.checksSource.title : null}
            </p>
          ) : null}
          <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="flex flex-col gap-2.5 p-4 sm:p-4">
              <span className="text-[13px] text-muted">Data entered</span>
              <span className="text-[22px] font-bold tabular-nums">{data.percent}%</span>
              <Bar percent={data.percent} label={`${data.year.label} data entered`} />
            </Card>
            <Card className="flex flex-col gap-1 p-4 sm:p-4">
              <span className="text-[13px] text-muted">Errors</span>
              <span className={cn('text-[22px] font-bold tabular-nums', data.checks.errors > 0 && 'text-red-strong')}>{data.checks.errors}</span>
              <span className="text-xs text-muted">Figures that cannot both be right</span>
            </Card>
            <Card className="flex flex-col gap-1 p-4 sm:p-4">
              <span className="text-[13px] text-muted">To check</span>
              <span className={cn('text-[22px] font-bold tabular-nums', data.checks.warnings > 0 && 'text-amber-strong')}>{data.checks.warnings}</span>
              <span className="text-xs text-muted">Unusual; confirm they are right</span>
            </Card>
            <Card className="flex flex-col gap-1 p-4 sm:p-4">
              <span className="text-[13px] text-muted">Checks passed</span>
              <span className="text-[22px] font-bold tabular-nums">
                {data.checks.passed} <span className="text-sm font-semibold text-muted">of {data.checks.total}</span>
              </span>
            </Card>
          </section>

          <div role="tablist" aria-label="AISHE" className="flex flex-wrap gap-2 border-b border-border pb-3">
            {(
              [
                ['forms', 'Data forms'],
                ['checks', `Consistency checks · ${data.checks.findings.length}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  'h-11 cursor-pointer rounded-control border px-4 text-sm',
                  tab === key ? 'border-primary bg-primary font-semibold text-white' : 'border-border bg-surface font-medium text-ink hover:bg-bg',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'forms' ? (
            <>
              <section aria-label="Survey blocks" className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
                {data.blocks.map((b) => {
                  const chosen = b.key === block?.key;
                  return (
                    <button
                      key={b.key}
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => setSelected(b.key)}
                      className={cn(
                        'flex min-h-11 cursor-pointer flex-col gap-2 rounded-card bg-surface p-4 text-left',
                        chosen ? 'border-2 border-primary shadow-[0_0_0_3px_var(--color-primary-soft)]' : 'border border-border hover:border-primary',
                      )}
                    >
                      <span className="text-[15px] font-bold">{b.name}</span>
                      <span className="flex w-full items-center gap-2">
                        <Bar percent={b.percent} label={`${b.name} data entered`} />
                        <span className="text-xs font-bold tabular-nums">{b.percent}%</span>
                      </span>
                    </button>
                  );
                })}
              </section>
              {block ? <BlockCard block={block} view={data} onAsk={() => setAsking(block)} /> : null}
            </>
          ) : (
            <>
              <Findings view={data} />
              <SubmittedFigures view={data} onRecord={(figure, portal) => setRecording({ figure, portal })} />
            </>
          )}

          <AskDialog
            block={asking}
            view={data}
            onClose={(text) => {
              setAsking(null);
              if (text) setMessage(text);
            }}
          />
          <RecordDialog
            target={recording}
            view={data}
            onClose={(text) => {
              setRecording(null);
              if (text) setMessage(text);
            }}
          />
        </>
      ) : null}
    </>
  );
}

function BlockCard({ block, view, onAsk }: { block: AisheBlockView; view: AisheView; onAsk: () => void }) {
  const labels = [view.previousYear?.label ?? 'Year before', view.year.label];
  return (
    <Card aria-labelledby="block-h" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="block-h" className="text-[17px] font-bold">
            {block.name}
          </h2>
          <p className="text-[13px] text-muted">Usually held by: {block.owner}</p>
        </div>
        {view.can.assign && block.items.length ? (
          <Button variant="secondary" onClick={onAsk}>
            Ask someone<span className="sr-only"> for {block.name}</span>
          </Button>
        ) : null}
      </div>
      {block.note ? <Notice tone="info">{block.note}</Notice> : null}

      {block.profile.length ? (
        <>
          <Table aria-labelledby="block-h" className="min-w-0">
            <tbody>
              {block.profile.map((p) => (
                <tr key={p.key}>
                  <Td className="w-1/2 text-secondary">{p.label}</Td>
                  <Td className="font-semibold">{p.value ?? <NotEntered />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-xs text-muted">
            Kept in <Link href="/setup">Institution setup</Link>.
          </p>
        </>
      ) : null}

      {block.items.length ? (
        <Table aria-labelledby="block-h" className="min-w-[480px]">
          <thead>
            <tr>
              <Th>Data item</Th>
              {labels.map((label) => (
                <Th key={label} className="text-right">
                  {label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.items.map((item) => (
              <tr key={item.key}>
                <Td>{item.label}</Td>
                {item.values.map((v, i) => (
                  <Td key={labels[i]} className="text-right tabular-nums">
                    {i === 0 && !view.previousYear ? <span className="text-muted">–</span> : (show(v, item.unit) ?? <NotEntered />)}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {block.perProgram ? (
        <>
          <h3 id="programmes-h" className="pt-2 text-[15px] font-bold">
            By programme, {view.year.label}
          </h3>
          {block.perProgram.rows.length === 0 ? (
            <p className="text-sm text-muted">
              No programmes yet. Add them in <Link href="/setup">Institution setup</Link>.
            </p>
          ) : (
            <Table aria-labelledby="programmes-h" className="min-w-[760px]">
              <thead>
                <tr>
                  <Th>Programme</Th>
                  {block.perProgram.itemKeys.map((key) => (
                    <Th key={key} className="text-right">
                      {columnLabel(block.items.find((i) => i.key === key)?.label ?? key)}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.perProgram.rows.map((row) => (
                  <tr key={row.id}>
                    <Td>
                      <span className="font-semibold">{row.name}</span> <span className="text-xs text-muted">{row.level}</span>
                    </Td>
                    {row.values.map((v, i) => (
                      <Td key={block.perProgram!.itemKeys[i]} className="text-right tabular-nums">
                        {v === null ? <span className="text-xs font-semibold text-red-strong">Not entered</span> : v.toLocaleString('en-IN')}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      ) : null}
      {block.items.length ? (
        <p className="text-xs text-muted">
          Entered in <Link href="/registers">Data registers</Link>.
        </p>
      ) : null}
    </Card>
  );
}

function Findings({ view }: { view: AisheView }) {
  const { findings } = view.checks;
  return (
    <Card aria-labelledby="findings-h" className="flex min-w-0 flex-col gap-3">
      <h2 id="findings-h" className="text-[17px] font-bold">
        Findings for {view.year.label}
      </h2>
      {findings.length === 0 ? (
        <p className="text-sm text-secondary">
          No problems found in {view.checks.total} checks. Checks only cover figures that have been entered.
        </p>
      ) : (
        <ul className="flex flex-col">
          {findings.map((f, i) => (
            <li key={`${f.code}-${i}`} className="flex flex-col gap-1.5 border-b border-row py-3 last:border-b-0 sm:flex-row sm:items-start sm:gap-4">
              <StatusPill tone={f.level === 'error' ? 'problem' : 'attention'} className="w-fit shrink-0">
                {f.level === 'error' ? 'Error' : 'Check'}
              </StatusPill>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="text-[13px] text-secondary">{f.detail}</p>
              </div>
              <Link href={f.fix.href} className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold sm:min-h-0">
                Fix in {f.fix.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SubmittedFigures({ view, onRecord }: { view: AisheView; onRecord: (figure: AisheFigureView, portal: Portal) => void }) {
  return (
    <Card id="submitted" aria-labelledby="submitted-h" className="flex min-w-0 flex-col gap-3">
      <div>
        <h2 id="submitted-h" className="text-[17px] font-bold">
          Submitted figures, {view.year.label}
        </h2>
        <p className="text-[13px] text-muted">
          What the college typed into each portal. YuCampus compares them with the registers and with each other; nothing is sent to any portal.
        </p>
      </div>
      <Table aria-labelledby="submitted-h" className="min-w-[720px]">
        <thead>
          <tr>
            <Th>Figure</Th>
            <Th className="text-right">Registers</Th>
            {PORTALS.map((p) => (
              <Th key={p} className="text-right">
                {p}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.figures.map((figure) => (
            <tr key={figure.key}>
              <Td>{figure.label}</Td>
              <Td className="text-right tabular-nums">{show(figure.registers, figure.unit) ?? <NotEntered />}</Td>
              {PORTALS.map((portal) => {
                if (!figure.portals.includes(portal)) {
                  return (
                    <Td key={portal} className="text-right text-xs text-muted">
                      Not asked
                    </Td>
                  );
                }
                const submitted = figure.submitted.find((s) => s.portal === portal);
                const differs = submitted && figure.registers !== null && Math.abs(submitted.value - figure.registers) >= 0.005;
                const text = submitted ? show(submitted.value, figure.unit) : view.can.recordSubmitted ? 'Record' : 'Not recorded';
                return (
                  <Td key={portal} className="text-right tabular-nums">
                    {view.can.recordSubmitted ? (
                      <Button variant="ghost" className={cn(differs && 'text-amber-strong')} onClick={() => onRecord(figure, portal)}>
                        {text}
                        <span className="sr-only">
                          {' '}
                          {figure.label} submitted to {portal}
                        </span>
                      </Button>
                    ) : (
                      <span className={cn(!submitted && 'text-xs text-muted', differs && 'text-amber-strong')}>{text}</span>
                    )}
                    {differs ? <span className="block text-xs font-semibold text-amber-strong">Differs</span> : null}
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function RecordDialog({ target, view, onClose }: { target: { figure: AisheFigureView; portal: Portal } | null; view: AisheView; onClose: (message?: string) => void }) {
  const queryClient = useQueryClient();
  const existing = target?.figure.submitted.find((s) => s.portal === target.portal);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const key = target ? `${target.figure.key}:${target.portal}` : null;
  if (key !== opened) {
    setOpened(key);
    setValue(existing ? String(existing.value) : '');
    setNote(existing?.note ?? '');
    setError(null);
  }
  const save = useMutation({
    mutationFn: (amount: number | null) =>
      api<AisheView>('/aishe/figures', {
        method: 'PUT',
        body: { academicYearId: view.year.id, portal: target!.portal, key: target!.figure.key, value: amount, note: note.trim() || null },
      }),
    onSuccess: (next, amount) => {
      queryClient.setQueryData(['aishe', view.year.id], next);
      void queryClient.invalidateQueries({ queryKey: ['aishe'] });
      onClose(amount === null ? `Removed ${target!.figure.label.toLowerCase()} for ${target!.portal}.` : `Recorded ${target!.figure.label.toLowerCase()} submitted to ${target!.portal}.`);
    },
  });
  return (
    <Dialog
      open={Boolean(target)}
      onClose={() => onClose()}
      title={target ? `${target.figure.label} submitted to ${target.portal}` : 'Submitted figure'}
      description={target ? `For ${view.year.label}. Registers: ${show(target.figure.registers, target.figure.unit) ?? 'not entered'}.` : undefined}
    >
      {target ? (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const amount = Number(value);
            if (value.trim() === '' || !Number.isFinite(amount) || amount < 0) {
              setError('Enter the figure as submitted, 0 or more.');
              return;
            }
            setError(null);
            save.mutate(amount);
          }}
        >
          <Field
            label={`Figure as submitted${target.figure.unit ? ` (${target.figure.unit})` : ''}`}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={error ?? undefined}
          />
          <Field label="Note (optional)" hint="e.g. where on the portal, or why it differs" value={note} onChange={(e) => setNote(e.target.value)} />
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            {existing ? (
              <Button variant="secondary" disabled={save.isPending} onClick={() => save.mutate(null)}>
                Remove
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => onClose()}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

/** Gives one block's data collection to a person or department, as a task with a reminder. */
function AskDialog({ block, view, onClose }: { block: AisheBlockView | null; view: AisheView; onClose: (message?: string) => void }) {
  const queryClient = useQueryClient();
  const [assignee, setAssignee] = useState('');
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10));
  const create = useMutation({
    mutationFn: () =>
      api('/tasks', {
        method: 'POST',
        body: {
          title: `AISHE ${view.year.label}: ${block!.name} data`.slice(0, 200),
          description: `Please enter in Data registers for ${view.year.label}: ${block!.items.map((i) => i.label).join('; ')}.`,
          assignee: toAssignee(assignee),
          dueDate,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose(`Asked for ${block!.name.toLowerCase()} data. It is on the Tasks page with reminders.`);
    },
  });
  return (
    <Dialog open={Boolean(block)} onClose={() => onClose()} title={block ? `Ask for ${block.name.toLowerCase()} data` : 'Ask someone'} description={block ? `Usually held by: ${block.owner}.` : undefined}>
      {block ? (
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
