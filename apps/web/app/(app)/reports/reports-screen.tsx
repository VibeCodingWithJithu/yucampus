'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AcademicYearView,
  type ExportFileView,
  type ExportView,
  REPORT_OUTPUT_LABELS,
  type ReportChecks,
  type ReportOutput,
  type ReportTemplateView,
} from '@yucampus/types';
import { Button, Card, Checkbox, Notice, SelectField, Table, Td, Th, cn } from '@yucampus/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatYearLabel } from '@/lib/format';
import { formatBytes } from '@/lib/upload';

const OUTPUTS: ReportOutput[] = ['report', 'index', 'pack', 'missing'];
/** A report choice: the template, and for a SAR the program (one card per program). */
const keyOf = (t: ReportTemplateView) => `${t.id}:${t.program?.id ?? ''}`;
/** The SAR's workbook holds outcome data, not an evidence index. */
const outputLabel = (t: ReportTemplateView, output: ReportOutput) =>
  t.program && output === 'index'
    ? { name: 'Outcome data (Excel)', info: 'PEOs, courses, CO and PO attainment, CO–PO mapping, students, faculty, research and facilities, one sheet each.' }
    : t.program && output === 'missing'
      ? { name: 'Missing items list (Excel)', info: 'Everything still missing, by SAR criterion, to share with the department.' }
      : REPORT_OUTPUT_LABELS[output];

const KIND_LABEL: Record<ExportFileView['kind'], string> = { docx: 'Word', pdf: 'PDF', xlsx: 'Excel', zip: 'ZIP' };

/** Reports that need data YuCampus does not collect yet. Shown so people know they are coming, never faked. */
const LATER = [
  { body: 'NIRF', name: 'Data sheets', info: 'Export them from the NIRF page' },
  { body: 'AISHE', name: 'Data forms', info: 'Export them from the AISHE page' },
];

/** Opens a short-lived download link; the browser saves the file without leaving the page. */
async function download(exportId: string, file: ExportFileView) {
  const { url } = await api<{ url: string }>(`/reports/exports/${exportId}/files/${file.index}`);
  window.location.assign(url);
}

function FileButtons({ item }: { item: ExportView }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        {item.files.map((file) => (
          <Button
            key={file.index}
            variant="secondary"
            onClick={() => download(item.id, file).catch((caught: unknown) => setError(errorMessage(caught)))}
          >
            {KIND_LABEL[file.kind]}
            <span className="sr-only">: {file.name}</span>
            <span className="text-xs font-normal text-muted">{formatBytes(file.size)}</span>
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ReportsScreen() {
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: ['reports', 'templates'], queryFn: () => api<ReportTemplateView[]>('/reports/templates') });
  const years = useQuery({ queryKey: ['academic-years'], queryFn: () => api<AcademicYearView[]>('/academic-years') });
  const history = useQuery({ queryKey: ['reports', 'exports'], queryFn: () => api<ExportView[]>('/reports/exports') });
  const [templateKey, setTemplateKey] = useState('');
  const [yearId, setYearId] = useState('');
  const [outputs, setOutputs] = useState<ReportOutput[]>([...OUTPUTS]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const template = templates.data?.find((t) => keyOf(t) === templateKey) ?? templates.data?.[0];
  useEffect(() => {
    if (!yearId && years.data) setYearId(years.data.find((y) => y.status === 'current')?.id ?? '');
  }, [yearId, years.data]);
  const year = template?.period === 'year' ? yearId : '';

  const checks = useQuery({
    queryKey: ['reports', 'checks', template ? keyOf(template) : '', year],
    queryFn: () =>
      api<ReportChecks>(`/reports/checks?template=${template!.id}${year ? `&year=${year}` : ''}${template!.program ? `&program=${template!.program.id}` : ''}`),
    enabled: Boolean(template) && (template?.period !== 'year' || Boolean(year)),
  });

  const create = useMutation({
    mutationFn: () =>
      api<ExportView>('/reports/exports', {
        method: 'POST',
        body: { templateId: template!.id, programId: template!.program?.id ?? null, academicYearId: year || null, outputs: outputs.filter((o) => template!.outputs.includes(o)) },
      }),
    onSuccess: (started) => {
      setCurrentId(started.id);
      void queryClient.invalidateQueries({ queryKey: ['reports', 'exports'] });
    },
  });
  // While files are being made, ask every two seconds; stop once they are ready or it failed.
  const current = useQuery({
    queryKey: ['reports', 'export', currentId],
    queryFn: () => api<ExportView>(`/reports/exports/${currentId}`),
    enabled: Boolean(currentId),
    refetchInterval: (query) => (query.state.data && ['done', 'failed'].includes(query.state.data.status) ? false : 2000),
  });
  useEffect(() => {
    if (current.data && ['done', 'failed'].includes(current.data.status)) void queryClient.invalidateQueries({ queryKey: ['reports', 'exports'] });
  }, [current.data, queryClient]);
  const working = create.isPending || (current.data ? ['queued', 'running'].includes(current.data.status) : Boolean(currentId));

  const toggle = (output: ReportOutput) =>
    setOutputs((chosen) => (chosen.includes(output) ? chosen.filter((o) => o !== output) : OUTPUTS.filter((o) => o === output || chosen.includes(o))));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Reports' }]}
        title="Reports and export"
        description="Create files from approved evidence only. Gaps are shown as gaps; nothing is filled in."
      />

      <section aria-labelledby="pick-h" className="flex flex-col gap-3">
        <h2 id="pick-h" className="text-[17px] font-bold">
          Choose a report
        </h2>
        {templates.isError ? <Notice tone="error">{errorMessage(templates.error)}</Notice> : null}
        <div role="group" aria-labelledby="pick-h" className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
          {templates.data?.map((t) => {
            const chosen = template !== undefined && keyOf(t) === keyOf(template);
            return (
              <button
                key={keyOf(t)}
                type="button"
                aria-pressed={chosen}
                onClick={() => {
                  setTemplateKey(keyOf(t));
                  setCurrentId(null);
                }}
                className={cn(
                  'flex cursor-pointer flex-col gap-1.5 rounded-card bg-surface p-4 text-left',
                  chosen ? 'border-2 border-primary shadow-[0_0_0_3px_var(--color-primary-soft)]' : 'border border-border hover:border-primary',
                )}
              >
                <span className="text-[11px] font-bold tracking-[0.04em] text-primary">{t.program ? 'NBA' : 'NAAC'}</span>
                <span className="text-[15px] font-bold">{t.program ? `SAR · ${t.program.name}` : t.name}</span>
                <span className="text-xs text-muted">{t.program ? `${t.framework.name.replace(/^NBA · /, '')}. ${t.description}` : t.description}</span>
              </button>
            );
          })}
          {LATER.map((later) => (
            <div key={later.body} className="flex flex-col gap-1.5 rounded-card border border-dashed border-border bg-bg p-4" aria-disabled="true">
              <span className="text-[11px] font-bold tracking-[0.04em] text-muted">{later.body}</span>
              <span className="text-[15px] font-bold text-secondary">{later.name}</span>
              <span className="text-xs text-muted">{later.info}</span>
            </div>
          ))}
        </div>
        {templates.data && templates.data.length === 0 ? (
          <Notice tone="info">
            No report is available to you. NAAC reports appear once your college chooses a NAAC framework, and an NBA SAR once a
            program has an NBA format (both in Institution setup).
          </Notice>
        ) : null}
      </section>

      {template ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <Card aria-labelledby="fix-h" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <h2 id="fix-h" className="text-[17px] font-bold">
                Fix before export
              </h2>
              <span className="text-xs font-semibold text-muted">
                {template.program ? `NBA · SAR · ${template.program.name}` : `NAAC · ${template.name.replace(/ \(.*\)$/, '')}`}
              </span>
            </div>
            {template.period === 'year' ? (
              <SelectField label="Academic year" value={yearId} onChange={(event) => setYearId(event.target.value)} className="max-w-48">
                {years.data?.map((y) => (
                  <option key={y.id} value={y.id}>
                    {formatYearLabel(y.label)}
                  </option>
                ))}
              </SelectField>
            ) : null}
            {checks.isError ? <Notice tone="error">{errorMessage(checks.error)}</Notice> : null}
            {checks.isPending ? <p className="text-sm text-muted">Checking…</p> : null}
            {checks.data ? (
              <>
                <p className="text-sm">{checks.data.summary}</p>
                {checks.data.issues.length === 0 ? <Notice tone="success">Nothing to fix.</Notice> : null}
                <ul className="flex flex-col gap-2">
                  {checks.data.issues.map((issue) => (
                    <li
                      key={issue.text}
                      className={cn('flex items-center gap-3 rounded-[10px] px-3.5 py-3', issue.level === 'must' ? 'bg-red-soft' : 'bg-amber-soft')}
                    >
                      <span className={cn('w-16 flex-none text-[11px] font-extrabold', issue.level === 'must' ? 'text-red-strong' : 'text-amber-strong')}>
                        {issue.level === 'must' ? 'MUST FIX' : 'CHECK'}
                      </span>
                      <span className="min-w-0 flex-1 text-sm leading-snug">{issue.text}</span>
                      {issue.link ? (
                        <Link href={issue.link} className="flex min-h-11 flex-none items-center text-[13px] font-semibold no-underline">
                          Fix<span className="sr-only">: {issue.text}</span>
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {checks.data.issues.some((i) => i.level === 'must') ? (
                  <p className="text-xs text-muted">You can still create the files now: anything missing is listed as missing.</p>
                ) : null}
              </>
            ) : null}
          </Card>

          <Card aria-labelledby="out-h" className="flex min-w-0 flex-col gap-3">
            <h2 id="out-h" className="text-[17px] font-bold">
              What to create
            </h2>
            <fieldset className="flex flex-col gap-2" disabled={working}>
              <legend className="sr-only">Files to create</legend>
              {OUTPUTS.filter((output) => template.outputs.includes(output)).map((output) => (
                <Checkbox
                  key={output}
                  label={outputLabel(template, output).name}
                  description={outputLabel(template, output).info}
                  checked={outputs.includes(output)}
                  onChange={() => toggle(output)}
                />
              ))}
            </fieldset>
            {create.isError ? <Notice tone="error">{errorMessage(create.error)}</Notice> : null}
            {current.data?.status === 'failed' ? <Notice tone="error">{current.data.error}</Notice> : null}
            {current.data?.status === 'done' ? (
              <div role="status" className="flex flex-col gap-3 rounded-[10px] bg-teal-soft px-3.5 py-3">
                <span className="text-sm font-semibold text-teal-strong">Files are ready: {current.data.label}</span>
                <FileButtons item={current.data} />
              </div>
            ) : working ? (
              <div role="status" className="rounded-[10px] bg-primary-soft px-3.5 py-3 text-sm font-semibold text-primary">
                Creating files… A large evidence pack can take a few minutes. You can leave this page; the files will be in the history.
              </div>
            ) : (
              <Button size="lg" disabled={!outputs.some((o) => template.outputs.includes(o)) || (template.period === 'year' && !year)} onClick={() => create.mutate()}>
                Create files
              </Button>
            )}
            {current.data && ['done', 'failed'].includes(current.data.status) ? (
              <Button variant="ghost" className="self-start" onClick={() => setCurrentId(null)}>
                Create other files
              </Button>
            ) : null}
          </Card>
        </div>
      ) : null}

      <Card aria-labelledby="hist-h" className="flex min-w-0 flex-col gap-3.5">
        <h2 id="hist-h" className="text-[17px] font-bold">
          Export history
        </h2>
        {history.isError ? <Notice tone="error">{errorMessage(history.error)}</Notice> : null}
        {history.data?.length === 0 ? <p className="text-sm text-muted">Nothing exported yet.</p> : null}
        {history.data?.length ? (
          <Table aria-labelledby="hist-h" className="min-w-[720px]">
            <thead>
              <tr>
                <Th>Report</Th>
                <Th>Files</Th>
                <Th>Created by</Th>
                <Th>Date</Th>
                <Th>Format version</Th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((item) => (
                <tr key={item.id}>
                  <Td className="font-semibold">{item.label}</Td>
                  <Td>
                    {item.status === 'done' ? (
                      <FileButtons item={item} />
                    ) : item.status === 'failed' ? (
                      <span className="text-[13px] text-red">Failed. {item.error}</span>
                    ) : (
                      <span className="text-[13px] text-muted">Being created…</span>
                    )}
                  </Td>
                  <Td>{item.createdBy}</Td>
                  <Td className="whitespace-nowrap">{formatDateTime(item.createdAt)}</Td>
                  <Td className="text-[13px] text-secondary">{item.formatVersion}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
      </Card>
    </>
  );
}
