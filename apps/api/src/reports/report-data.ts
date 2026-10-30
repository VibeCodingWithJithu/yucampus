// Everything a report shows, gathered once inside one tenant transaction. The renderers (Word, PDF, Excel, ZIP)
// only lay it out, so every file of an export tells the same story. Only finally approved evidence is used
// (CLAUDE.md rule 3); a document without approved evidence is shown as missing, never filled in.

import type { MetricDataView } from '@yucampus/types';
import { type ApprovedLink, average, metricReadiness, yearsWindow } from '../accreditation/readiness.js';
import { metricData, parseDataSource } from '../registers/metric-data.js';
import type { TenantClient } from '../prisma/prisma.service.js';

export interface ReportEvidence {
  id: string;
  title: string;
  year: string;
  documentDate: string | null;
  department: string | null;
  uploadedBy: string;
  approvedAt: string | null;
  fileKey: string;
  fileType: string;
  /** Where the file sits in the evidence pack, e.g. "C3 Research.../3.3.1/1. Proof - Paper (2025-26).pdf". */
  packPath: string;
}

export interface ReportDocument {
  key: string;
  name: string;
  evidence: ReportEvidence[];
  /** The open task for a missing document, if someone has been asked for it. */
  owner: { task: string; assignee: string; dueDate: string | null } | null;
}

export interface ReportMetric {
  id: string;
  code: string;
  name: string;
  type: string;
  yearsRequired: number;
  /** The academic years whose evidence counts, oldest first. */
  years: string[];
  percent: number;
  documents: ReportDocument[];
  /** Approved evidence linked to the metric without naming one of several documents. */
  other: ReportEvidence[];
  /** Numbers from the data registers for the same years, when the template maps the metric. */
  data: MetricDataView | null;
}

export interface ReportCriterion {
  number: number;
  name: string;
  percent: number;
  pending: boolean;
  metrics: ReportMetric[];
}

export interface ReportModel {
  /** e.g. "Self Study Report (SSR)" */
  title: string;
  /** e.g. "NAAC SSR 2026-27" (used for the history and file names) */
  label: string;
  college: { name: string; type: string };
  framework: { name: string; version: string; verified: boolean; sourceTitle: string };
  layoutVersion: string;
  period: { kind: 'cycle' | 'year'; text: string };
  /** e.g. "CSE department only"; null for the whole college. */
  scope: string | null;
  generatedAt: Date;
  generatedBy: string;
  percent: number;
  criteria: ReportCriterion[];
}

export interface ReportRequest {
  collegeId: string;
  templateId: string;
  academicYearId?: string | null;
  departmentIds?: string[] | null;
  createdById: string;
}

export class ReportDataError extends Error {}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/** Safe on Windows, macOS and inside ZIPs: no reserved characters, no trailing dots, a sensible length. */
export function safeName(text: string, max = 80): string {
  const clean = text
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
  return cut.replace(/[. ]+$/, '') || 'Untitled';
}

const yearLabel = (label: string) => label.replace('-', '–');

export async function buildReportModel(db: TenantClient, request: ReportRequest): Promise<ReportModel> {
  const { collegeId } = request;
  const template = await db.reportTemplate.findUnique({ where: { id: request.templateId }, include: { framework: true } });
  if (!template) throw new ReportDataError('That report format no longer exists.');
  const layout = template.layout as { name?: string; period?: 'cycle' | 'year' };
  const periodKind = layout.period ?? 'cycle';

  const [college, years, creator, criteria, departments] = await Promise.all([
    db.college.findUniqueOrThrow({ where: { id: collegeId }, select: { name: true, type: true } }),
    db.academicYear.findMany({ where: { collegeId }, select: { id: true, label: true, startDate: true, status: true } }),
    db.user.findFirst({ where: { id: request.createdById, collegeId }, select: { name: true } }),
    db.criterion.findMany({
      where: { frameworkId: template.frameworkId },
      include: { metrics: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { number: 'asc' },
    }),
    db.department.findMany({ where: { collegeId }, select: { id: true, code: true } }),
  ]);
  const yearById = new Map(years.map((y) => [y.id, y]));
  const codeOf = new Map(departments.map((d) => [d.id, d.code]));

  let fixedYear: (typeof years)[number] | undefined;
  if (periodKind === 'year') {
    fixedYear = request.academicYearId ? yearById.get(request.academicYearId) : years.find((y) => y.status === 'current');
    if (!fixedYear) throw new ReportDataError('Choose the academic year for this report.');
  }
  const windowFor = (yearsRequired: number) => (fixedYear ? new Set([fixedYear.id]) : yearsWindow(years, yearsRequired));

  // Approved evidence linked to this framework's metrics, limited to the scope's departments.
  const metricIds = criteria.flatMap((c) => c.metrics.map((m) => m.id));
  const departmentIds = request.departmentIds?.length ? request.departmentIds : null;
  const links = await db.evidenceMetric.findMany({
    where: {
      collegeId,
      metricId: { in: metricIds },
      evidence: { status: 'approved', ...(departmentIds ? { departmentId: { in: departmentIds } } : {}) },
    },
    select: {
      metricId: true,
      documentKey: true,
      evidence: {
        select: {
          id: true,
          title: true,
          academicYearId: true,
          documentDate: true,
          departmentId: true,
          fileKey: true,
          fileType: true,
          uploadedById: true,
          reviewActions: { where: { action: 'approved', level: 'final' }, orderBy: { at: 'desc' }, take: 1, select: { at: true } },
        },
      },
    },
  });
  const [uploaders, openTasks] = await Promise.all([
    db.user.findMany({
      where: { collegeId, id: { in: [...new Set(links.map((l) => l.evidence.uploadedById))] } },
      select: { id: true, name: true },
    }),
    db.task.findMany({
      where: { collegeId, status: { not: 'done' }, metricId: { in: metricIds } },
      select: { title: true, metricId: true, documentKey: true, dueDate: true, assigneeUserId: true, assigneeDepartmentId: true },
      orderBy: { dueDate: 'asc' },
    }),
  ]);
  const assigneeNames = new Map(
    (
      await db.user.findMany({
        where: { collegeId, id: { in: openTasks.map((t) => t.assigneeUserId).filter((id): id is string => Boolean(id)) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const uploaderName = new Map(uploaders.map((u) => [u.id, u.name]));
  const approved: ApprovedLink[] = links.map((l) => ({
    evidenceId: l.evidence.id,
    metricId: l.metricId,
    documentKey: l.documentKey,
    academicYearId: l.evidence.academicYearId,
  }));

  const usedPaths = new Set<string>();
  const packPath = (folder: string, base: string, fileType: string) => {
    const extension = EXTENSIONS[fileType] ?? 'bin';
    let path = `${folder}/${base}.${extension}`;
    for (let n = 2; usedPaths.has(path.toLowerCase()); n++) path = `${folder}/${base} (${n}).${extension}`;
    usedPaths.add(path.toLowerCase());
    return path;
  };
  const toEvidence = (link: (typeof links)[number], folder: string, prefix: string): ReportEvidence => {
    const e = link.evidence;
    const year = yearById.get(e.academicYearId)?.label ?? '';
    return {
      id: e.id,
      title: e.title,
      year: yearLabel(year),
      documentDate: e.documentDate ? e.documentDate.toISOString().slice(0, 10) : null,
      department: e.departmentId ? (codeOf.get(e.departmentId) ?? null) : null,
      uploadedBy: uploaderName.get(e.uploadedById) ?? 'Someone',
      approvedAt: e.reviewActions[0]?.at.toISOString() ?? null,
      fileKey: e.fileKey,
      fileType: e.fileType,
      packPath: packPath(folder, safeName(`${prefix}${e.title} (${year})`, 100), e.fileType),
    };
  };

  const reportCriteria: ReportCriterion[] = criteria
    .filter((criterion) => criterion.appliesToInstitutionTypes.includes(college.type))
    .map((criterion) => {
      const criterionFolder = safeName(`C${criterion.number} ${criterion.name}`, 60);
      const metrics = criterion.metrics.map((metric): ReportMetric => {
        const documents = (Array.isArray(metric.requiredDocuments) ? metric.requiredDocuments : []) as { key: string; name: string }[];
        const window = windowFor(metric.yearsRequired);
        const readiness = metricReadiness(
          {
            id: metric.id,
            code: metric.code,
            name: metric.name,
            criterionNumber: criterion.number,
            yearsRequired: metric.yearsRequired,
            weight: metric.weight,
            requiredDocuments: documents,
          },
          approved,
          window,
        );
        const counted = links.filter((l) => l.metricId === metric.id && window.has(l.evidence.academicYearId));
        const only = documents.length === 1 ? documents[0]!.key : null;
        const folder = `${criterionFolder}/${safeName(metric.code, 20)}`;
        return {
          id: metric.id,
          code: metric.code,
          name: metric.name,
          type: metric.type,
          yearsRequired: metric.yearsRequired,
          years: [...window]
            .map((id) => yearById.get(id))
            .filter((y): y is NonNullable<typeof y> => Boolean(y))
            .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
            .map((y) => yearLabel(y.label)),
          percent: readiness.percent,
          documents: documents.map((doc, index) => {
            const evidence = counted
              .filter((l) => (l.documentKey ?? only) === doc.key)
              .map((l) => toEvidence(l, folder, `${index + 1}. ${safeName(doc.name, 40)} - `));
            const task = evidence.length ? undefined : openTasks.find((t) => t.metricId === metric.id && (t.documentKey === doc.key || !t.documentKey));
            return {
              key: doc.key,
              name: doc.name,
              evidence,
              owner: task
                ? {
                    task: task.title,
                    assignee: task.assigneeUserId
                      ? (assigneeNames.get(task.assigneeUserId) ?? 'Someone')
                      : `All ${codeOf.get(task.assigneeDepartmentId ?? '') ?? ''} faculty`.replace('  ', ' '),
                    dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
                  }
                : null,
            };
          }),
          other: counted
            .filter((l) => {
              const key = l.documentKey ?? only;
              return !key || !documents.some((d) => d.key === key);
            })
            .map((l) => toEvidence(l, folder, 'Other - ')),
          data: null,
        };
      });
      const percent = average(
        metrics.map((m) => m.percent),
        criterion.metrics.map((m) => m.weight ?? 0),
      );
      return { number: criterion.number, name: criterion.name, percent, pending: metrics.length === 0, metrics };
    });

  // Register numbers for the same years the evidence covers (and the same departments for a HOD's report).
  for (const criterion of criteria) {
    for (const metric of criterion.metrics) {
      const source = parseDataSource(metric.dataSource);
      const target = reportCriteria.find((c) => c.number === criterion.number)?.metrics.find((m) => m.id === metric.id);
      if (!source || !target) continue;
      const window = windowFor(metric.yearsRequired);
      const dataYears = years
        .filter((y) => window.has(y.id))
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
        .map((y) => ({ id: y.id, label: y.label }));
      target.data = await metricData(db, collegeId, source, dataYears, departmentIds);
    }
  }

  const weights = new Map(
    criteria.map((c) => [c.number, ((c.weights as Record<string, number> | null) ?? {})[college.type] ?? 0]),
  );
  const loaded = reportCriteria.filter((c) => !c.pending);
  const kindName = template.kind === 'SSR' ? 'SSR' : template.kind;
  const periodText = fixedYear
    ? `Academic year ${yearLabel(fixedYear.label)}`
    : (() => {
        const span = [...new Set(reportCriteria.flatMap((c) => c.metrics.flatMap((m) => m.years)))].sort();
        return span.length > 1 ? `Academic years ${span[0]} to ${span[span.length - 1]}` : `Academic year ${span[0] ?? 'not set'}`;
      })();
  const currentYear = years.find((y) => y.status === 'current');

  return {
    title: layout.name ?? kindName,
    label: `${template.framework.body} ${kindName} ${yearLabel((fixedYear ?? currentYear)?.label ?? '')}`.trim(),
    college: { name: college.name, type: college.type },
    framework: {
      name: template.framework.name,
      version: template.framework.version,
      verified: Boolean((template.framework.source as { verified?: boolean } | null)?.verified),
      sourceTitle: (template.framework.source as { title?: string } | null)?.title ?? '',
    },
    layoutVersion: template.version,
    period: { kind: periodKind, text: periodText },
    scope: departmentIds ? `${departmentIds.map((id) => codeOf.get(id) ?? '').filter(Boolean).join(', ')} department${departmentIds.length > 1 ? 's' : ''} only` : null,
    generatedAt: new Date(),
    generatedBy: creator?.name ?? 'Someone',
    percent: average(
      loaded.map((c) => c.percent),
      loaded.map((c) => weights.get(c.number) ?? 0),
    ),
    criteria: reportCriteria,
  };
}

/** Every distinct evidence file in the report with its pack path (an item linked to two metrics appears twice). */
export function packEntries(model: ReportModel): ReportEvidence[] {
  return model.criteria.flatMap((c) => c.metrics.flatMap((m) => [...m.documents.flatMap((d) => d.evidence), ...m.other]));
}

/** Register numbers as table rows (measures, then ratios), one cell per year. "Not entered" when a year has no records. */
export function dataRows(data: MetricDataView): { label: string; cells: string[] }[] {
  const show = (value: number | null, unit?: string, format?: 'percent' | 'per') =>
    value === null ? 'Not entered' : format === 'percent' ? `${value}%` : `${value.toLocaleString('en-IN')}${unit ? ` ${unit}` : ''}`;
  return [
    ...data.measures.map((m, i) => ({ label: m.label, cells: data.years.map((y) => show(y.values[i] ?? null, m.unit)) })),
    ...data.ratios.map((r, i) => ({ label: r.label, cells: data.years.map((y) => show(y.ratios[i] ?? null, undefined, r.format)) })),
  ];
}
