'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcademicYearView,
  BulkLinkResult,
  DepartmentView,
  DownloadLink,
  EvidenceCard,
  EvidenceLibraryPage,
} from '@yucampus/types';
import { Button, Card, Checkbox, Dialog, Notice, SelectField, buttonClasses, cn } from '@yucampus/ui';
import { FILE_KINDS, MAX_BULK_ITEMS } from '@yucampus/validation';
import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { EvidenceStatus } from '@/components/evidence-status';
import { MetricPicker, useLinkableMetrics } from '@/components/metric-links';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatYearLabel, plural } from '@/lib/format';
import { formatBytes } from '@/lib/upload';
import { MAX_ZIP_BYTES, downloadAsZip } from '@/lib/zip';

const PAGE_SIZE = 24;

const STATUSES = [
  { value: 'approved', label: 'Approved' },
  { value: 'in_review,department_approved', label: 'In review' },
  { value: 'needs_fix', label: 'Needs fix' },
  { value: 'rejected', label: 'Rejected' },
] as const;

const KIND_LABEL: Record<(typeof FILE_KINDS)[number], string> = {
  pdf: 'PDF',
  image: 'Photos and images',
  word: 'Word',
  excel: 'Excel',
  powerpoint: 'PowerPoint',
};

/** Short type badge, e.g. "PDF", "JPG", "XLSX". */
function typeBadge(fileType: string, fileName: string) {
  if (fileType === 'application/pdf') return { text: 'PDF', className: 'bg-red text-white' };
  if (fileType.startsWith('image/'))
    return { text: fileName.split('.').pop()?.toUpperCase() ?? 'IMG', className: 'bg-teal text-white' };
  if (fileType.includes('spreadsheet')) return { text: 'XLSX', className: 'bg-[#1F7A3A] text-white' };
  if (fileType.includes('presentation')) return { text: 'PPTX', className: 'bg-amber-fill text-white' };
  return { text: 'DOCX', className: 'bg-primary text-white' };
}

export function LibraryScreen() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const seesOthers =
    can('evidence.approve_final') ||
    can('evidence.approve_department') ||
    can('dashboards.view', ['college', 'department']);
  const canLink = can('evidence.approve_final', ['college']) || can('evidence.approve_department');

  // The dashboard's search box opens the library with ?search=.
  const [search, setSearch] = useState(useSearchParams().get('search') ?? '');
  const deferredSearch = useDeferredValue(search.trim());
  const [yearId, setYearId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [criterion, setCriterion] = useState('');
  const [kind, setKind] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<string, EvidenceCard>>(new Map());
  const [linking, setLinking] = useState(false);
  const [zipProgress, setZipProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  // Filters start open beside the list on wide screens, and folded away on phones so documents come first.
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => setFiltersOpen(window.matchMedia('(min-width: 1280px)').matches), []);

  const years = useQuery({ queryKey: ['academic-years'], queryFn: () => api<AcademicYearView[]>('/academic-years') });
  const departments = useQuery({
    queryKey: ['departments'],
    queryFn: () => api<DepartmentView[]>('/departments'),
    enabled: seesOthers,
  });
  const metrics = useLinkableMetrics();
  const criteria = useMemo(() => {
    const seen = new Map<string, string>();
    for (const metric of metrics.data ?? []) {
      seen.set(
        `${metric.framework.id}:${metric.criterion.number}`,
        `${metric.framework.body} C${metric.criterion.number} · ${metric.criterion.name}`,
      );
    }
    return [...seen];
  }, [metrics.data]);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (deferredSearch) params.set('search', deferredSearch);
  if (yearId) params.set('yearId', yearId);
  if (departmentId) params.set('departmentId', departmentId);
  if (criterion) params.set('criterion', criterion);
  if (kind) params.set('kind', kind);
  if (statuses.length) params.set('status', statuses.join(','));
  if (mine) params.set('mine', 'true');

  const library = useQuery({
    queryKey: ['evidence', 'library', params.toString()],
    queryFn: () => api<EvidenceLibraryPage>(`/evidence/library?${params}`),
    placeholderData: keepPreviousData,
  });
  const pages = library.data ? Math.max(1, Math.ceil(library.data.total / PAGE_SIZE)) : 1;
  const filtersOn = Boolean(deferredSearch || yearId || departmentId || criterion || kind || statuses.length || mine);

  // Any filter change starts again from page 1.
  const change =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  function toggle(item: EvidenceCard) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(item.id)) next.delete(item.id);
      else if (next.size < MAX_BULK_ITEMS) next.set(item.id, item);
      return next;
    });
  }

  async function zipSelected() {
    setNotice(null);
    const items = [...selected.values()];
    const bytes = items.reduce((sum, item) => sum + item.fileSize, 0);
    if (bytes > MAX_ZIP_BYTES) {
      setNotice({
        tone: 'error',
        text: `That is ${formatBytes(bytes)}. Choose up to ${formatBytes(MAX_ZIP_BYTES)} at a time.`,
      });
      return;
    }
    try {
      setZipProgress('Preparing…');
      const links = await api<DownloadLink[]>('/evidence/bulk/download-links', {
        method: 'POST',
        body: { evidenceIds: items.map((i) => i.id) },
      });
      await downloadAsZip(links, `yucampus-evidence-${new Date().toISOString().slice(0, 10)}.zip`, (done, total) =>
        setZipProgress(`Downloading ${done} of ${total}…`),
      );
      setNotice({ tone: 'success', text: `Saved ${plural(links.length, 'file')} as a ZIP.` });
    } catch (error) {
      setNotice({ tone: 'error', text: errorMessage(error) });
    } finally {
      setZipProgress(null);
    }
  }

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Evidence library' }]}
        title="Evidence library"
        description={
          seesOthers
            ? 'Every document in one place, sorted by criterion, year and department.'
            : 'Everything you have uploaded.'
        }
        actions={
          can('evidence.upload') ? (
            <Link href="/evidence/upload" className={buttonClasses()}>
              Upload evidence
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="p-4 sm:p-5">
          <details open={filtersOpen} onToggle={(event) => setFiltersOpen(event.currentTarget.open)}>
            <summary className="flex min-h-11 cursor-pointer items-center justify-between text-[15px] font-bold">
              Filters
              {filtersOn ? (
                <span className="text-[13px] font-semibold text-primary">
                  <button
                    type="button"
                    className="min-h-11 cursor-pointer px-2"
                    onClick={(event) => {
                      event.preventDefault();
                      setSearch('');
                      setYearId('');
                      setDepartmentId('');
                      setCriterion('');
                      setKind('');
                      setStatuses([]);
                      setMine(false);
                      setPage(1);
                    }}
                  >
                    Clear all
                  </button>
                </span>
              ) : null}
            </summary>
            <div className="mt-3 flex flex-col gap-4">
              <SelectField label="Academic year" value={yearId} onChange={(e) => change(setYearId)(e.target.value)}>
                <option value="">All years</option>
                {years.data
                  ?.filter((year) => year.status !== 'next')
                  .map((year) => (
                    <option key={year.id} value={year.id}>
                      {formatYearLabel(year.label)}
                      {year.status === 'current' ? ' (current)' : ''}
                    </option>
                  ))}
              </SelectField>
              <SelectField label="Criterion" value={criterion} onChange={(e) => change(setCriterion)(e.target.value)}>
                <option value="">All criteria</option>
                {criteria.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectField>
              {seesOthers ? (
                <SelectField
                  label="Department"
                  value={departmentId}
                  onChange={(e) => change(setDepartmentId)(e.target.value)}
                >
                  <option value="">All departments</option>
                  {departments.data?.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.code} · {department.name}
                    </option>
                  ))}
                </SelectField>
              ) : null}
              <SelectField label="File type" value={kind} onChange={(e) => change(setKind)(e.target.value)}>
                <option value="">All types</option>
                {FILE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </SelectField>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-[13px] font-semibold text-muted">Status</legend>
                {STATUSES.map((status) => (
                  <Checkbox
                    key={status.value}
                    label={status.label}
                    checked={statuses.includes(status.value)}
                    onChange={(event) =>
                      change(setStatuses)(
                        event.target.checked ? [...statuses, status.value] : statuses.filter((s) => s !== status.value),
                      )
                    }
                  />
                ))}
              </fieldset>
              {seesOthers ? (
                <Checkbox label="Only my uploads" checked={mine} onChange={(e) => change(setMine)(e.target.checked)} />
              ) : null}
            </div>
          </details>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="search"
              aria-label="Search documents"
              placeholder="Search by title, note or file name"
              value={search}
              onChange={(e) => change(setSearch)(e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-control border border-border bg-surface px-3.5 text-sm"
            />
            <span className="text-sm text-muted" aria-live="polite">
              {library.data ? plural(library.data.total, 'document') : ''}
            </span>
          </div>

          <div
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-card border border-border px-4 py-3',
              selected.size ? 'bg-primary-soft' : 'bg-surface',
            )}
          >
            <span className="flex-1 text-sm">
              {selected.size
                ? `${plural(selected.size, 'document')} selected`
                : 'Select documents to download or link them together.'}
            </span>
            {selected.size ? (
              <>
                <Button variant="secondary" onClick={() => void zipSelected()} disabled={zipProgress !== null}>
                  {zipProgress ?? 'Download as ZIP'}
                </Button>
                {canLink ? (
                  <Button variant="secondary" onClick={() => setLinking(true)}>
                    Link to a metric
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => setSelected(new Map())}>
                  Clear selection
                </Button>
              </>
            ) : null}
          </div>
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
          {library.isError ? <Notice tone="error">{errorMessage(library.error)}</Notice> : null}
          {library.isPending ? <p className="text-sm text-muted">Loading…</p> : null}
          {library.data?.items.length === 0 ? (
            <Card className="text-center text-sm text-secondary">
              {filtersOn
                ? 'No documents match. Try fewer filters.'
                : 'No evidence yet. Uploads appear here once they are sent.'}
            </Card>
          ) : null}

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3" aria-busy={library.isFetching}>
            {library.data?.items.map((item) => {
              const badge = typeBadge(item.fileType, item.fileName);
              const isSelected = selected.has(item.id);
              return (
                <li key={item.id}>
                  <article
                    className={cn(
                      'flex h-full flex-col gap-3 rounded-card bg-surface p-4',
                      isSelected ? 'border-2 border-primary' : 'border border-border',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('rounded-md px-2 py-1 text-[11px] font-bold', badge.className)}>
                        {badge.text}
                      </span>
                      <label className="flex size-11 cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          className="size-5 accent-primary"
                          checked={isSelected}
                          onChange={() => toggle(item)}
                          aria-label={`Select ${item.title}`}
                        />
                      </label>
                    </div>
                    <Link
                      href={`/evidence/${item.id}`}
                      className="text-[15px] font-bold text-ink no-underline hover:underline"
                    >
                      {item.title}
                    </Link>
                    {item.tags.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {item.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-amber-strong">Not linked to a metric yet</span>
                    )}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                      <span>
                        {item.uploadedBy.name}
                        {item.department ? ` · ${item.department.code}` : ''} · {formatDateTime(item.updatedAt)}
                      </span>
                      <EvidenceStatus stage={item.stage} />
                    </div>
                    <Link
                      href={`/evidence/${item.id}#versions`}
                      className="text-xs font-semibold text-primary no-underline hover:underline"
                    >
                      Version {item.version} · see history
                    </Link>
                  </article>
                </li>
              );
            })}
          </ul>

          {library.data && library.data.total > PAGE_SIZE ? (
            <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      </div>

      <Dialog
        open={linking}
        onClose={() => setLinking(false)}
        title={`Link ${plural(selected.size, 'document')} to a metric`}
        description="Each document keeps its other links. Documents you may not change are skipped."
      >
        {linking ? (
          <BulkLinkForm
            ids={[...selected.keys()]}
            onDone={(result) => {
              setLinking(false);
              setNotice({
                tone: 'success',
                text: `Linked ${plural(result.linked, 'document')}.${result.skipped ? ` ${plural(result.skipped, 'document was', 'documents were')} skipped (already linked or not yours to change).` : ''}`,
              });
              void queryClient.invalidateQueries({ queryKey: ['evidence'] });
              void queryClient.invalidateQueries({ queryKey: ['accreditation'] });
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function BulkLinkForm({ ids, onDone }: { ids: string[]; onDone: (result: BulkLinkResult) => void }) {
  const [link, setLink] = useState({ metricId: '', documentKey: null as string | null });
  const save = useMutation({
    mutationFn: () =>
      api<BulkLinkResult>('/evidence/bulk/link', {
        method: 'POST',
        body: { evidenceIds: ids, metricId: link.metricId, documentKey: link.documentKey },
      }),
    onSuccess: onDone,
  });
  return (
    <div className="flex flex-col gap-4">
      <MetricPicker value={link} onChange={setLink} label="Metric" />
      {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
      <div>
        <Button onClick={() => save.mutate()} disabled={!link.metricId || save.isPending}>
          {save.isPending ? 'Linking…' : 'Link documents'}
        </Button>
      </div>
    </div>
  );
}
