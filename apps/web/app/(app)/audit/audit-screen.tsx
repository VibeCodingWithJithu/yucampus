'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AuditEntryView, AuditPage } from '@yucampus/types';
import { Button, Card, Field, Notice, SelectField, Table, Td, Th } from '@yucampus/ui';
import { Fragment, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { api, apiDownload, errorMessage } from '@/lib/api';
import { plural } from '@/lib/format';

const PAGE_SIZE = 30;
const WHEN = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function who(entry: AuditEntryView) {
  if (entry.actor === 'support') return 'YuCampus support';
  if (entry.actor === 'system') return 'YuCampus (automatic)';
  return entry.who!.name;
}

export function AuditScreen() {
  const [person, setPerson] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const filters = new URLSearchParams();
  if (person) filters.set('userId', person);
  if (entity) filters.set('entity', entity);
  if (from) filters.set('from', from);
  if (to) filters.set('to', to);
  const query = new URLSearchParams(filters);
  query.set('page', String(pageNumber));
  query.set('pageSize', String(PAGE_SIZE));
  const log = useQuery({
    queryKey: ['audit', query.toString()],
    queryFn: () => api<AuditPage>(`/audit?${query}`),
    placeholderData: keepPreviousData,
  });
  const data = log.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filtered = filters.size > 0;
  const change = (set: (value: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setPageNumber(1);
  };

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Audit log' }]}
        title="Audit log"
        description="Who changed what in your college, and when. Entries cannot be edited or deleted."
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              setDownloadError(null);
              apiDownload(`/audit/csv?${filters}`, 'audit-log.csv').catch((e: unknown) => setDownloadError(errorMessage(e)));
            }}
          >
            Download CSV
          </Button>
        }
      />
      {downloadError ? <Notice tone="error">{downloadError}</Notice> : null}

      <Card aria-label="Filters" className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-2 sm:py-4 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-end">
        <SelectField label="Person" value={person} onChange={change(setPerson)}>
          <option value="">Everyone</option>
          {data?.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Kind of record" value={entity} onChange={change(setEntity)}>
          <option value="">All kinds</option>
          {data?.entities.map((e) => (
            <option key={e.key} value={e.key}>
              {e.label}
            </option>
          ))}
        </SelectField>
        <Field label="From" type="date" value={from} max={to || undefined} onChange={change(setFrom)} />
        <Field label="To" type="date" value={to} min={from || undefined} onChange={change(setTo)} />
        <Button
          variant="ghost"
          disabled={!filtered}
          onClick={() => {
            setPerson('');
            setEntity('');
            setFrom('');
            setTo('');
            setPageNumber(1);
          }}
        >
          Clear filters
        </Button>
      </Card>

      {log.isError ? <Notice tone="error">{errorMessage(log.error)}</Notice> : null}
      {log.isPending ? <p className="text-sm text-muted">Loading…</p> : null}

      {data ? (
        <Card aria-labelledby="log-h" className="flex min-w-0 flex-col gap-3">
          <h2 id="log-h" className="text-[17px] font-bold">
            {plural(data.total, 'entry', 'entries')}
            {filtered ? (data.total === 1 ? ' matches' : ' match') : ''}
          </h2>
          {data.items.length === 0 ? (
            <p className="text-sm text-muted">{filtered ? 'Nothing matches these filters.' : 'Nothing has been recorded yet.'}</p>
          ) : (
            <Table aria-labelledby="log-h" className="min-w-[680px]">
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>Record</Th>
                  <Th>What happened</Th>
                  <Th>
                    <span className="sr-only">Changes</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr>
                      <Td className="whitespace-nowrap text-secondary tabular-nums">{WHEN.format(new Date(entry.at))}</Td>
                      <Td className={entry.actor === 'person' ? 'font-semibold' : 'text-secondary italic'}>{who(entry)}</Td>
                      <Td>{entry.entityLabel}</Td>
                      <Td>{entry.actionLabel}</Td>
                      <Td className="text-right">
                        {entry.changes.length ? (
                          <Button variant="ghost" aria-expanded={open === entry.id} onClick={() => setOpen(open === entry.id ? null : entry.id)}>
                            {open === entry.id ? 'Hide changes' : `${plural(entry.changes.length, 'change')}`}
                          </Button>
                        ) : null}
                      </Td>
                    </tr>
                    {open === entry.id ? (
                      <tr>
                        <td colSpan={5} className="bg-bg px-5 py-3 sm:px-6">
                          <table className="w-full text-[13px]">
                            <thead>
                              <tr className="text-left text-xs text-muted">
                                <th className="py-1 pr-3 font-semibold">Field</th>
                                <th className="py-1 pr-3 font-semibold">Before</th>
                                <th className="py-1 pr-3 font-semibold">After</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entry.changes.map((c) => (
                                <tr key={c.field} className="align-top">
                                  <td className="py-1 pr-3 font-semibold">{c.field}</td>
                                  <td className="max-w-80 py-1 pr-3 break-words text-secondary">{c.before ?? <span className="text-muted">–</span>}</td>
                                  <td className="max-w-80 py-1 pr-3 break-words">{c.after ?? <span className="text-muted">–</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="mt-2 text-xs text-muted">Record id {entry.entityId}</p>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          )}
          {data.total > PAGE_SIZE ? (
            <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted">
                Page {pageNumber} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={pageNumber <= 1} onClick={() => setPageNumber((n) => n - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" disabled={pageNumber >= pages} onClick={() => setPageNumber((n) => n + 1)}>
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
