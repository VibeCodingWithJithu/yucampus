'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AcademicYearView, DepartmentView, RegisterPage, RegisterRecordView, RegisterSummary } from '@yucampus/types';
import { Button, Card, Field, Notice, SelectField, Table, Td, Th, cn } from '@yucampus/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { formatYearLabel, plural } from '@/lib/format';
import { formatRegisterValue } from '@/lib/registers';
import { RecordDialog } from './record-dialog';
import { RegisterImportDialog } from './register-import-dialog';

const PAGE_SIZE = 25;

export function RegistersScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [yearId, setYearId] = useState('');
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [departmentId, setDepartmentId] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [editing, setEditing] = useState<RegisterRecordView | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const years = useQuery({ queryKey: ['academic-years'], queryFn: () => api<AcademicYearView[]>('/academic-years') });
  useEffect(() => {
    if (!yearId && years.data) setYearId(years.data.find((y) => y.status === 'current')?.id ?? years.data[0]?.id ?? '');
  }, [yearId, years.data]);
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api<DepartmentView[]>('/departments') });
  const list = useQuery({
    queryKey: ['registers', 'list', yearId],
    queryFn: () => api<RegisterSummary[]>(`/registers?year=${yearId}`),
    enabled: Boolean(yearId),
    placeholderData: keepPreviousData,
  });
  const code = params.get('register') ?? list.data?.[0]?.code ?? '';
  const query = new URLSearchParams({ year: yearId, page: String(pageNumber), pageSize: String(PAGE_SIZE) });
  if (term) query.set('search', term);
  if (departmentId) query.set('department', departmentId);
  if (onlyMissing) query.set('missing', 'true');
  const register = useQuery({
    queryKey: ['registers', 'page', code, query.toString()],
    queryFn: () => api<RegisterPage>(`/registers/${code}?${query}`),
    enabled: Boolean(code && yearId),
    placeholderData: keepPreviousData,
  });
  const copy = useMutation({
    mutationFn: () => api<{ copied: number }>(`/registers/${code}/copy`, { method: 'POST', body: { toYearId: yearId } }),
    onSuccess: ({ copied }) => {
      setMessage(`Copied ${plural(copied, 'record')}. Check each one and update what changed.`);
      void queryClient.invalidateQueries({ queryKey: ['registers'] });
    },
  });

  const pick = (next: string) => {
    setPageNumber(1);
    setSearch('');
    setDepartmentId('');
    setOnlyMissing(false);
    setMessage(null);
    router.replace(`${pathname}?register=${next}`, { scroll: false });
  };
  const data = register.data;
  const definition = data?.definition;
  const columns = definition?.fields.filter((f) => f.column) ?? [];
  const title = definition?.fields.find((f) => f.key === definition.titleField);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const readsWholeCollege = can('registers.edit', ['college']) || can('dashboards.view', ['college']);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Data registers' }]}
        title="Data registers"
        description="Enter each record once. YuCampus reuses it for NAAC, NBA, NIRF and AISHE."
        actions={
          definition?.can.add ? (
            <>
              {definition.can.import ? (
                <Button variant="secondary" onClick={() => setImporting(true)}>
                  Import from Excel
                </Button>
              ) : null}
              <Button onClick={() => setEditing('new')}>Add a record</Button>
            </>
          ) : undefined
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {list.isError ? <Notice tone="error">{errorMessage(list.error)}</Notice> : null}

      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div role="tablist" aria-label="Registers" className="flex flex-wrap gap-2">
          {list.data?.map((r) => (
            <button
              key={r.code}
              type="button"
              role="tab"
              aria-selected={r.code === code}
              onClick={() => pick(r.code)}
              className={cn(
                'h-11 cursor-pointer rounded-control border px-4 text-sm',
                r.code === code ? 'border-primary bg-primary font-semibold text-white' : 'border-border bg-surface font-medium text-ink hover:bg-bg',
              )}
            >
              {r.name} <span className="text-xs opacity-80">· {r.records.toLocaleString('en-IN')}</span>
            </button>
          ))}
        </div>
        <SelectField label="Academic year" value={yearId} onChange={(e) => { setYearId(e.target.value); setPageNumber(1); }} className="w-36">
          {years.data?.map((y) => (
            <option key={y.id} value={y.id}>
              {formatYearLabel(y.label)}
              {y.status === 'locked' ? ' (locked)' : ''}
            </option>
          ))}
        </SelectField>
      </div>

      {definition ? (
        <>
          <Card aria-labelledby="use-h" className="flex flex-wrap items-center gap-2.5 py-4 sm:py-4">
            <h2 id="use-h" className="text-sm font-bold">
              This register fills:
            </h2>
            {definition.feeds.map((feed) => (
              <span key={feed} className="rounded-md bg-primary-soft px-2.5 py-1 text-xs font-bold text-primary">
                {feed}
              </span>
            ))}
            {!definition.verified ? (
              <p className="basis-full text-xs text-amber-strong">
                The fields are a first proposal, not yet checked against the current NAAC, NIRF and AISHE formats.
              </p>
            ) : null}
          </Card>

          <Card aria-labelledby="reg-h" className="flex min-w-0 flex-col gap-3.5" role="tabpanel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="reg-h" className="text-[17px] font-bold">
                  {definition.name} · {formatYearLabel(data.year.label)}
                </h2>
                <p className="text-[13px] text-muted">{definition.description}</p>
              </div>
              {data.incomplete ? (
                <button
                  type="button"
                  aria-pressed={onlyMissing}
                  onClick={() => { setOnlyMissing((v) => !v); setPageNumber(1); }}
                  className={cn(
                    'min-h-11 cursor-pointer rounded-full px-3.5 text-[13px] font-semibold',
                    onlyMissing ? 'bg-amber-strong text-white' : 'bg-amber-soft text-amber-strong',
                  )}
                >
                  {plural(data.incomplete, 'record has', 'records have')} missing items{onlyMissing ? ' · showing only these' : ''}
                </button>
              ) : null}
            </div>
            {data.year.locked ? <Notice tone="info">{formatYearLabel(data.year.label)} is locked: records can be read but not changed.</Notice> : null}

            <div className="flex flex-wrap items-end gap-3">
              <Field
                label="Search"
                type="search"
                className="w-64 max-w-full"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPageNumber(1); }}
              />
              {readsWholeCollege && definition.department !== 'none' ? (
                <SelectField label="Department" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPageNumber(1); }} className="w-48">
                  <option value="">All departments</option>
                  {departments.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code}
                    </option>
                  ))}
                </SelectField>
              ) : null}
            </div>

            {register.isError ? <Notice tone="error">{errorMessage(register.error)}</Notice> : null}
            {data.total === 0 ? (
              <div className="flex flex-col items-start gap-3 py-4">
                <p className="text-sm text-muted">
                  {term || onlyMissing || departmentId ? 'No records match.' : `No ${definition.name.toLowerCase()} records for ${formatYearLabel(data.year.label)} yet.`}
                </p>
                {data.copyFrom && !term ? (
                  <Button variant="secondary" disabled={copy.isPending} onClick={() => copy.mutate()}>
                    Copy {plural(data.copyFrom.records, 'record')} from {formatYearLabel(data.copyFrom.label)}
                  </Button>
                ) : null}
                {copy.isError ? <Notice tone="error">{errorMessage(copy.error)}</Notice> : null}
              </div>
            ) : (
              <Table aria-labelledby="reg-h" className="min-w-[720px]">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <Th key={c.key}>{c.label}</Th>
                    ))}
                    {definition.department !== 'none' ? <Th>Department</Th> : null}
                    {definition.proof !== 'none' ? <Th>Proof</Th> : null}
                    <Th>
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id}>
                      {columns.map((c) => {
                        const text = formatRegisterValue(c, item.data[c.key], data.programs);
                        const missing = !text && item.missing.includes(c.key);
                        return (
                          <Td key={c.key} className={cn(c.key === title?.key && 'font-semibold', missing && 'bg-red-soft font-semibold text-red-strong')}>
                            {text ?? (missing ? 'Missing' : '–')}
                          </Td>
                        );
                      })}
                      {definition.department !== 'none' ? (
                        <Td className={cn(item.missing.includes('department') && 'bg-red-soft font-semibold text-red-strong')}>
                          {item.department?.code ?? (item.missing.includes('department') ? 'Missing' : 'College')}
                        </Td>
                      ) : null}
                      {definition.proof !== 'none' ? (
                        <Td className={cn(item.missing.includes('proof') && 'bg-red-soft font-semibold text-red-strong')}>
                          {item.proofs.length ? `${item.proofs.length} linked` : item.missing.includes('proof') ? 'Missing' : '–'}
                        </Td>
                      ) : null}
                      <Td className="text-right">
                        <Button variant="ghost" onClick={() => setEditing(item)}>
                          {item.can.edit ? 'Edit' : 'View'}
                          <span className="sr-only"> {item.title}</span>
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {data.total > PAGE_SIZE ? (
              <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted">
                  Page {pageNumber} of {pages} · {plural(data.total, 'record')}
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

          <RecordDialog
            register={data}
            record={editing}
            onClose={(text) => {
              setEditing(null);
              if (text) setMessage(text);
            }}
          />
          <RegisterImportDialog
            register={data}
            open={importing}
            onClose={(text) => {
              setImporting(false);
              if (text) setMessage(text);
            }}
          />
        </>
      ) : register.isPending && code ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : null}
    </>
  );
}
