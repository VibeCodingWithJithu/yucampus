import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type ExportView,
  type ReportChecks,
  type ReportIssue,
  type ReportOutput,
  type ReportTemplateView,
  can,
  departmentsFor,
} from '@yucampus/types';
import type { CreateExportInput } from '@yucampus/validation';
import { AccreditationService } from '../accreditation/accreditation.service.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { notFound } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Jobs } from '../jobs/jobs.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';
import { FileStorage, newFileKey } from '../storage/file-storage.js';
import { ReportDataError, type ReportModel, buildReportModel, safeName } from './report-data.js';
import { blocksDocx, blocksPdf, blocksXlsx, gapsXlsx } from './render-blocks.js';
import { reportDocx } from './render-docx.js';
import { reportPdf } from './render-pdf.js';
import { evidenceIndexXlsx, missingItemsXlsx } from './render-xlsx.js';
import { evidencePackZip } from './render-zip.js';
import { buildSarModel, sarLayout } from './sar-data.js';

/**
 * Whose data an export covers: the college, or (HOD) their departments. `nba` (NBA coordinator) reaches every
 * program's SAR but no NAAC report.
 */
type Scope = { college: true } | { college: false; departments: string[]; nba: boolean };

const ALL_OUTPUTS: ReportOutput[] = ['report', 'index', 'pack', 'missing'];
/** A SAR has no evidence pack yet: NBA evidence is not linked to SAR criteria. */
const SAR_OUTPUTS: ReportOutput[] = ['report', 'index', 'missing'];

interface StoredFile {
  key: string;
  name: string;
  kind: 'docx' | 'pdf' | 'xlsx' | 'zip';
  size: number;
}

const CONTENT_TYPES: Record<StoredFile['kind'], string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};
/** An export still queued or running after this long was interrupted (e.g. the server restarted). */
const STALE_MS = 2 * 60 * 60 * 1000;
const PENDING = ['in_review', 'department_approved'] as const;
const yearLabel = (label: string) => label.replace('-', '–');
const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

type ExportRow = Prisma.ExportJobGetPayload<{ include: { template: { include: { framework: true } } } }>;

@Injectable()
export class ReportsService implements OnModuleInit {
  private readonly logger = new Logger('Reports');

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly accreditation: AccreditationService,
    private readonly storage: FileStorage,
    private readonly jobs: Jobs,
  ) {}

  onModuleInit() {
    this.jobs.register('reports.generate', async (data) => {
      await this.run(String(data.collegeId), String(data.exportId));
    });
  }

  private async scopeOf(actor: AuthUser): Promise<Scope | null> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    if (can(grants, 'reports.generate', ['college'])) return { college: true };
    const departments = departmentsFor(grants, 'reports.generate');
    const nba = can(grants, 'reports.generate', ['nba']);
    return departments.length || nba ? { college: false, departments, nba } : null;
  }

  // ---------------------------------------------------------------- Choosing a report

  /** Report formats of the frameworks the college works against, and each NBA program's SAR. NIRF and AISHE come later. */
  async templates(actor: AuthUser): Promise<ReportTemplateView[]> {
    const scope = await this.scopeOf(actor);
    if (!scope) return [];
    return this.prisma.forTenant(actor.collegeId, (db) => this.templatesIn(db, actor.collegeId, scope));
  }

  private async templatesIn(db: TenantClient, collegeId: string, scope: Scope): Promise<ReportTemplateView[]> {
    const view = (row: Prisma.ReportTemplateGetPayload<{ include: { framework: true } }>, program: { id: string; name: string } | null): ReportTemplateView => {
      const layout = row.layout as { name?: string; description?: string; period?: 'cycle' | 'year'; source?: { verified?: boolean } };
      return {
        id: row.id,
        kind: row.kind,
        name: layout.name ?? row.kind,
        description: layout.description ?? '',
        period: layout.period ?? 'cycle',
        version: row.version,
        framework: {
          id: row.framework.id,
          name: row.framework.name,
          verified: Boolean(program ? layout.source?.verified : (row.framework.source as { verified?: boolean } | null)?.verified),
        },
        program,
        outputs: program ? SAR_OUTPUTS : ALL_OUTPUTS,
      };
    };

    // NAAC (college-wide): the frameworks the college works against.
    const naac: ReportTemplateView[] = [];
    if (scope.college || scope.departments.length) {
      const active = await this.accreditation.activeFrameworkIds(db, collegeId);
      const rows = await db.reportTemplate.findMany({ where: { frameworkId: { in: active }, framework: { attachesTo: 'college' } }, include: { framework: true } });
      const order = ['SSR', 'AQAR', 'NIRF_SHEET', 'AISHE'];
      naac.push(
        ...rows
          .sort((a, b) => active.indexOf(a.frameworkId) - active.indexOf(b.frameworkId) || order.indexOf(a.kind) - order.indexOf(b.kind))
          .map((row) => view(row, null)),
      );
    }

    // NBA SAR: one per program that uses an NBA format with a SAR layout.
    const programs = await db.program.findMany({
      where: { collegeId, ...(scope.college || scope.nba ? {} : { departmentId: { in: scope.departments } }), frameworks: { some: { active: true } } },
      include: { frameworks: { where: { active: true }, select: { frameworkId: true } } },
      orderBy: { name: 'asc' },
    });
    const sars = await db.reportTemplate.findMany({
      where: { kind: 'SAR', frameworkId: { in: [...new Set(programs.flatMap((p) => p.frameworks.map((f) => f.frameworkId)))] } },
      include: { framework: true },
    });
    const sar = programs.flatMap((program) =>
      sars.filter((t) => program.frameworks.some((f) => f.frameworkId === t.frameworkId) && sarLayout(t.layout)).map((t) => view(t, { id: program.id, name: program.name })),
    );
    return [...naac, ...sar];
  }

  private async templateFor(db: TenantClient, collegeId: string, scope: Scope, templateId: string, programId?: string | null) {
    const template = (await this.templatesIn(db, collegeId, scope)).find((t) => t.id === templateId && (t.program?.id ?? null) === (t.program ? (programId ?? null) : null));
    if (!template) throw notFound('report');
    return template;
  }

  private async yearFor(db: TenantClient, collegeId: string, yearId?: string | null) {
    const year = yearId
      ? await db.academicYear.findFirst({ where: { id: yearId, collegeId } })
      : await db.academicYear.findFirst({ where: { collegeId, status: 'current' } });
    if (!year) throw yearId ? notFound('academic year') : apiError(409, 'no_current_year', 'Your college has no current academic year.');
    return year;
  }

  // ---------------------------------------------------------------- Fix before export

  /** What to fix (or know) before creating the files. Nothing here blocks an export: gaps show as gaps. */
  async checks(actor: AuthUser, templateId: string, yearId?: string, programId?: string): Promise<ReportChecks> {
    const scope = await this.scopeOf(actor);
    if (!scope) throw apiError(403, 'forbidden', 'You cannot create reports.');
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const collegeId = actor.collegeId;
      const template = await this.templateFor(db, collegeId, scope, templateId, programId);
      const year = template.period === 'year' ? await this.yearFor(db, collegeId, yearId) : null;
      if (template.program) return this.sarChecks(db, actor, template.id, template.program.id, year?.id);
      if (!scope.college && !scope.departments.length) throw notFound('report');
      const model = await buildReportModel(db, {
        collegeId,
        templateId,
        academicYearId: year?.id,
        departmentIds: scope.college ? null : scope.departments,
        createdById: actor.id,
      });
      const issues: ReportIssue[] = [];
      let covered = 0;
      let missing = 0;
      for (const criterion of model.criteria) {
        const gaps = criterion.metrics.reduce((sum, m) => sum + m.documents.filter((d) => d.evidence.length === 0).length, 0);
        covered += criterion.metrics.reduce((sum, m) => sum + m.documents.filter((d) => d.evidence.length > 0).length, 0);
        missing += gaps;
        if (gaps) {
          issues.push({
            level: 'must',
            text: `Proof missing for ${plural(gaps, 'document')} in Criterion ${criterion.number} (${criterion.name})`,
            link: `/naac/criteria/${criterion.number}`,
          });
        }
      }
      const notEntered = model.criteria.flatMap((c) => c.metrics).filter((m) => m.data?.years.some((y) => y.values.some((v) => v === null)));
      if (notEntered.length) {
        issues.push({
          level: 'check',
          text: `${plural(notEntered.length, 'metric')} ${notEntered.length === 1 ? 'needs' : 'need'} register data that has not been entered for every year (${notEntered
            .slice(0, 4)
            .map((m) => m.code)
            .join(', ')}${notEntered.length > 4 ? ', …' : ''})`,
          link: '/registers',
        });
      }
      if (!template.framework.verified) {
        issues.push({
          level: 'check',
          text: `${template.framework.name} is not yet checked against the official manual. Check the metric list before submitting.`,
          link: null,
        });
      }

      const inScope: Prisma.EvidenceWhereInput = {
        collegeId,
        ...(scope.college ? {} : { departmentId: { in: scope.departments } }),
        ...(year ? { academicYearId: year.id } : {}),
      };
      const metricIds = model.criteria.flatMap((c) => c.metrics.map((m) => m.id));
      const [pending, unlinked, dated] = await Promise.all([
        db.evidence.count({ where: { ...inScope, status: { in: [...PENDING] }, metrics: { some: { metricId: { in: metricIds } } } } }),
        db.evidence.count({ where: { ...inScope, status: 'approved', metrics: { none: {} } } }),
        db.evidence.findMany({
          where: { ...inScope, status: 'approved', documentDate: { not: null } },
          select: { documentDate: true, academicYearId: true },
        }),
      ]);
      if (pending) {
        issues.push({
          level: 'check',
          text: `${plural(pending, 'document')} linked to metrics ${pending === 1 ? 'is' : 'are'} still waiting for approval and will be left out`,
          link: '/review',
        });
      }
      if (unlinked) {
        issues.push({
          level: 'check',
          text: `${plural(unlinked, 'approved document')} ${unlinked === 1 ? 'is' : 'are'} not linked to any metric, so ${unlinked === 1 ? 'it is' : 'they are'} not in the report`,
          link: '/evidence',
        });
      }
      const years = new Map(
        (await db.academicYear.findMany({ where: { collegeId }, select: { id: true, startDate: true, endDate: true } })).map((y) => [y.id, y]),
      );
      const outside = dated.filter((e) => {
        const y = years.get(e.academicYearId);
        return y && (e.documentDate! < y.startDate || e.documentDate! > y.endDate);
      }).length;
      if (outside) {
        issues.push({
          level: 'check',
          text: `${plural(outside, 'approved document')} ${outside === 1 ? 'has a date' : 'have dates'} outside ${outside === 1 ? 'its' : 'their'} academic year`,
          link: '/evidence',
        });
      }
      return {
        issues,
        covered,
        missing,
        summary: `${covered} of ${covered + missing} required documents have approved evidence${year ? ' in this year' : ''}.`,
      };
    });
  }

  /** SAR gaps as checks: missing data in criteria YuCampus compiles must be fixed; the rest are written by hand. */
  private async sarChecks(db: TenantClient, actor: AuthUser, templateId: string, programId: string, yearId?: string): Promise<ReportChecks> {
    const model = await buildSarModel(db, { collegeId: actor.collegeId, templateId, programId, academicYearId: yearId, createdById: actor.id });
    const compiled = model.gaps.filter((g) => g.criterion <= 6);
    const byHand = model.gaps.filter((g) => g.criterion > 6);
    const linkFor = (criterion: number) => (criterion <= 3 ? `/nba?program=${programId}` : '/registers');
    const issues: ReportIssue[] = [
      ...compiled.slice(0, 12).map((g) => ({ level: 'must' as const, text: `Criterion ${g.criterion}: ${g.text}`, link: linkFor(g.criterion) })),
      ...(compiled.length > 12 ? [{ level: 'must' as const, text: `${compiled.length - 12} more gaps are listed in the missing items file.`, link: null }] : []),
      ...(byHand.length ? [{ level: 'check' as const, text: `Criteria ${byHand.map((g) => g.criterion).join(', ')} are not compiled from YuCampus yet; write them in the SAR yourself.`, link: null }] : []),
      ...(model.verified ? [] : [{ level: 'check' as const, text: 'The SAR structure is not yet checked against the current NBA format.', link: null }]),
    ];
    const criteriaWithGaps = new Set(compiled.map((g) => g.criterion)).size;
    return {
      issues,
      covered: 6 - criteriaWithGaps,
      missing: compiled.length,
      summary: `${6 - criteriaWithGaps} of the 6 criteria YuCampus compiles are complete for ${model.programName}.`,
    };
  }

  // ---------------------------------------------------------------- Exports

  async create(actor: AuthUser, input: CreateExportInput): Promise<ExportView> {
    const scope = await this.scopeOf(actor);
    if (!scope) throw apiError(403, 'forbidden', 'You cannot create reports.');
    const id = await this.prisma.forTenant(actor.collegeId, async (db) => {
      const collegeId = actor.collegeId;
      const template = await this.templateFor(db, collegeId, scope, input.templateId, input.programId);
      if (!template.program && !scope.college && !scope.departments.length) throw notFound('report');
      const outputs = input.outputs.filter((o) => template.outputs.includes(o));
      if (outputs.length === 0) throw apiError(400, 'invalid_input', 'Choose at least one file this report can create.');
      const year = template.period === 'year' ? await this.yearFor(db, collegeId, input.academicYearId) : null;
      const busy = await db.exportJob.count({
        where: { collegeId, status: { in: ['queued', 'running'] }, createdAt: { gt: new Date(Date.now() - STALE_MS) } },
      });
      if (busy) throw apiError(409, 'export_running', 'Files are already being created for your college. Wait for them to finish.');
      const current = year ?? (await db.academicYear.findFirst({ where: { collegeId, status: 'current' } }));
      const body = template.framework.name.split(' ')[0] ?? '';
      const job = await db.exportJob.create({
        data: {
          collegeId,
          templateId: template.id,
          label: template.program
            ? `NBA SAR ${template.program.name}${current ? ` ${yearLabel(current.label)}` : ''}`
            : `${body} ${template.kind}${current ? ` ${yearLabel(current.label)}` : ''}`,
          params: {
            academicYearId: year?.id ?? null,
            departmentIds: scope.college || template.program ? null : scope.departments,
            programId: template.program?.id ?? null,
          },
          outputs,
          createdById: actor.id,
        },
      });
      await audit(db, actor, 'export', job.id, 'create', { after: { template: template.name, outputs: input.outputs } });
      return job.id;
    });
    // Slow work runs in the background (CLAUDE.md rule 4); the page polls the export until it is done.
    await this.jobs.enqueue('reports.generate', { collegeId: actor.collegeId, exportId: id });
    return this.get(actor, id);
  }

  async list(actor: AuthUser): Promise<ExportView[]> {
    const scope = await this.scopeOf(actor);
    if (!scope) return [];
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const rows = await db.exportJob.findMany({
        where: { collegeId: actor.collegeId, ...(scope.college ? {} : { createdById: actor.id }) },
        include: { template: { include: { framework: true } } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      });
      return this.views(db, actor.collegeId, rows);
    });
  }

  async get(actor: AuthUser, id: string): Promise<ExportView> {
    return this.prisma.forTenant(actor.collegeId, async (db) => this.views(db, actor.collegeId, [await this.row(db, actor, id)]).then((v) => v[0]!));
  }

  /** A short-lived link to one of the files. */
  async download(actor: AuthUser, id: string, index: number): Promise<{ url: string; name: string }> {
    const row = await this.prisma.forTenant(actor.collegeId, (db) => this.row(db, actor, id));
    const file = (row.files as unknown as StoredFile[])[index];
    if (row.status !== 'done' || !file) throw notFound('file');
    const link = await this.storage.presignDownload({ key: file.key, fileName: file.name });
    return { url: link.url, name: file.name };
  }

  private async row(db: TenantClient, actor: AuthUser, id: string): Promise<ExportRow> {
    const scope = await this.scopeOf(actor);
    const row = await db.exportJob.findFirst({
      where: { id, collegeId: actor.collegeId, ...(scope?.college ? {} : { createdById: actor.id }) },
      include: { template: { include: { framework: true } } },
    });
    if (!row || !scope) throw notFound('export');
    return row;
  }

  private async views(db: TenantClient, collegeId: string, rows: ExportRow[]): Promise<ExportView[]> {
    const people = await db.user.findMany({
      where: { collegeId, id: { in: [...new Set(rows.map((r) => r.createdById))] } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    return rows.map((row) => {
      const stale = (row.status === 'queued' || row.status === 'running') && Date.now() - row.createdAt.getTime() > STALE_MS;
      return {
        id: row.id,
        label: row.label,
        formatVersion: `${row.template.framework.name}, layout ${row.template.version}`,
        outputs: row.outputs as ReportOutput[],
        status: stale ? 'failed' : row.status,
        createdBy: nameOf.get(row.createdById) ?? 'Someone',
        createdAt: row.createdAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
        files: (row.files as unknown as StoredFile[]).map((f, index) => ({ index, name: f.name, kind: f.kind, size: f.size })),
        error: stale ? 'This was interrupted. Create the files again.' : row.error,
      };
    });
  }

  // ---------------------------------------------------------------- The background job

  /** Builds the requested files, stores them, and records the result. Safe to run again for the same export. */
  async run(collegeId: string, exportId: string): Promise<void> {
    const job = await this.prisma.forTenant(collegeId, (db) => db.exportJob.findFirst({ where: { id: exportId, collegeId } }));
    if (!job || job.status === 'done') return;
    await this.prisma.forTenant(collegeId, (db) => db.exportJob.update({ where: { id: job.id }, data: { status: 'running', error: null } }));

    const folder = await mkdtemp(join(tmpdir(), 'yucampus-export-'));
    const stored: StoredFile[] = [];
    try {
      const params = job.params as { academicYearId?: string | null; departmentIds?: string[] | null; programId?: string | null };
      const outputs = job.outputs as ReportOutput[];
      const put = async (name: string, kind: StoredFile['kind'], body: Buffer) => {
        const key = newFileKey(collegeId, 'export', name);
        await this.storage.write({ key, body, contentType: CONTENT_TYPES[kind], size: body.length });
        stored.push({ key, name, kind, size: body.length });
      };

      if (params.programId) {
        const sar = await this.prisma.forTenant(collegeId, (db) =>
          buildSarModel(db, { collegeId, templateId: job.templateId, programId: params.programId!, academicYearId: params.academicYearId, createdById: job.createdById }),
        );
        const base = safeName(sar.label, 70);
        if (outputs.includes('report')) {
          await put(`${base} - Report.docx`, 'docx', await blocksDocx(sar));
          await put(`${base} - Report.pdf`, 'pdf', await blocksPdf(sar));
        }
        if (outputs.includes('index')) await put(`${base} - Outcome data.xlsx`, 'xlsx', await blocksXlsx(sar));
        if (outputs.includes('missing')) await put(`${base} - Missing items.xlsx`, 'xlsx', await gapsXlsx(sar));
        await this.prisma.forTenant(collegeId, (db) =>
          db.exportJob.update({
            where: { id: job.id },
            data: { status: 'done', files: stored as unknown as Prisma.InputJsonArray, finishedAt: new Date(), label: sar.label },
          }),
        );
        return;
      }

      const model = await this.prisma.forTenant(collegeId, (db) =>
        buildReportModel(db, {
          collegeId,
          templateId: job.templateId,
          academicYearId: params.academicYearId,
          departmentIds: params.departmentIds,
          createdById: job.createdById,
        }),
      );
      const base = safeName(model.label, 60);

      let index: Buffer | null = null;
      if (outputs.includes('report')) {
        await put(`${base} - Report.docx`, 'docx', await reportDocx(model));
        await put(`${base} - Report.pdf`, 'pdf', await reportPdf(model));
      }
      if (outputs.includes('index') || outputs.includes('pack')) index = await evidenceIndexXlsx(model);
      if (outputs.includes('index')) await put(`${base} - Evidence index.xlsx`, 'xlsx', index!);
      if (outputs.includes('missing')) await put(`${base} - Missing items.xlsx`, 'xlsx', await missingItemsXlsx(model));
      if (outputs.includes('pack')) await this.storePack(collegeId, model, index!, folder, `${base} - Evidence pack.zip`, stored);

      await this.prisma.forTenant(collegeId, (db) =>
        db.exportJob.update({
          where: { id: job.id },
          data: { status: 'done', files: stored as unknown as Prisma.InputJsonArray, finishedAt: new Date(), label: model.label },
        }),
      );
    } catch (error) {
      this.logger.error(`Export ${exportId} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      // Files of a failed run are removed; the person creates the export again.
      await Promise.all(stored.map((f) => this.storage.remove(f.key).catch(() => undefined)));
      await this.prisma.forTenant(collegeId, (db) =>
        db.exportJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            error:
              error instanceof ReportDataError
                ? error.message
                : 'Something went wrong while creating the files. Try again; if it happens again, contact YuCampus support.',
          },
        }),
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  private async storePack(collegeId: string, model: ReportModel, index: Buffer, folder: string, name: string, stored: StoredFile[]) {
    const path = join(folder, 'pack.zip');
    await evidencePackZip(model, this.storage, index, path);
    const { size } = await stat(path);
    const key = newFileKey(collegeId, 'export', name);
    await this.storage.write({ key, body: createReadStream(path), contentType: CONTENT_TYPES.zip, size });
    stored.push({ key, name, kind: 'zip', size });
  }
}
