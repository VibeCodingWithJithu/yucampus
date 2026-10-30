import { Injectable } from '@nestjs/common';
import {
  type BulkLinkResult,
  type DownloadLink,
  type EvidenceCard,
  type EvidenceLibraryPage,
  type EvidenceVersionView,
  type Grant,
  can,
  departmentsFor,
} from '@yucampus/types';
import type { BulkLinkInput, FileKind, LibraryQuery } from '@yucampus/validation';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { notFound } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FileStorage } from '../storage/file-storage.js';
import { EvidenceService } from './evidence.service.js';

const KIND_TYPES: Record<FileKind, string[]> = {
  pdf: ['application/pdf'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
  word: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  excel: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  powerpoint: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
};

/** Finding, browsing and reusing evidence across the college (roadmap slice 5). */
@Injectable()
export class EvidenceLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly storage: FileStorage,
    private readonly evidence: EvidenceService,
  ) {}

  /**
   * The evidence a person may see, as a database filter. It matches EvidenceService's rule for a single item:
   * their own uploads; their departments' items (HOD); everything for final approvers and college dashboards.
   */
  visibleWhere(actor: AuthUser, grants: readonly Grant[]): Prisma.EvidenceWhereInput {
    if (can(grants, 'evidence.approve_final', ['college']) || can(grants, 'dashboards.view', ['college'])) return {};
    const departments = [...departmentsFor(grants, 'evidence.approve_department'), ...departmentsFor(grants, 'dashboards.view')];
    return { OR: [{ uploadedById: actor.id }, ...(departments.length ? [{ departmentId: { in: departments } }] : [])] };
  }

  async search(actor: AuthUser, query: LibraryQuery): Promise<EvidenceLibraryPage> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    const search = query.search?.trim();
    const filters: Prisma.EvidenceWhereInput[] = [this.visibleWhere(actor, grants)];
    if (search) {
      filters.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { fileName: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (query.criterion) {
      const [frameworkId, number] = query.criterion.split(':');
      filters.push({ metrics: { some: { metric: { criterion: { frameworkId, number: Number(number) } } } } });
    }
    const where: Prisma.EvidenceWhereInput = {
      collegeId: actor.collegeId,
      AND: filters,
      ...(query.yearId ? { academicYearId: query.yearId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.status?.length ? { status: { in: query.status } } : {}),
      ...(query.metricId ? { metrics: { some: { metricId: query.metricId } } } : {}),
      ...(query.kind ? { fileType: { in: KIND_TYPES[query.kind] } } : {}),
      ...(query.mine ? { uploadedById: actor.id } : {}),
    };

    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const [rows, total] = await Promise.all([
        db.evidence.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: { id: true, metrics: { select: { metric: { select: { code: true, criterion: { select: { framework: { select: { body: true } } } } } } } } },
        }),
        db.evidence.count({ where }),
      ]);
      const summaries = await this.evidence.summariesFor(db, actor.collegeId, rows.map((row) => row.id));
      const byId = new Map(summaries.map((summary) => [summary.id, summary]));
      const items: EvidenceCard[] = rows.map((row) => ({
        ...byId.get(row.id)!,
        tags: row.metrics.map((link) => `${link.metric.criterion.framework.body} ${link.metric.code}`).sort(),
      }));
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  async versions(actor: AuthUser, id: string): Promise<EvidenceVersionView[]> {
    const current = await this.evidence.get(actor, id); // Applies the visibility rule.
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const rows = await db.evidenceVersion.findMany({ where: { collegeId: actor.collegeId, evidenceId: id }, orderBy: { version: 'desc' } });
      const people = await db.user.findMany({
        where: { collegeId: actor.collegeId, id: { in: [...new Set(rows.map((r) => r.uploadedById))] } },
        select: { id: true, name: true },
      });
      const nameOf = new Map(people.map((p) => [p.id, p.name]));
      return rows.map((row) => ({
        version: row.version,
        fileName: row.fileName,
        fileType: row.fileType,
        fileSize: row.fileSize,
        uploadedBy: nameOf.get(row.uploadedById) ?? 'Someone',
        uploadedAt: row.uploadedAt.toISOString(),
        current: row.version === current.version,
      }));
    });
  }

  async versionLink(actor: AuthUser, id: string, version: number, inline: boolean) {
    await this.evidence.get(actor, id); // Applies the visibility rule.
    const row = await this.prisma.forTenant(actor.collegeId, (db) =>
      db.evidenceVersion.findFirst({ where: { collegeId: actor.collegeId, evidenceId: id, version } }),
    );
    if (!row) throw notFound('version');
    return this.storage.presignDownload({ key: row.fileKey, fileName: row.fileName, inline });
  }

  /**
   * Links many items to one metric. Each item is checked exactly as a single change would be; items the person
   * may not change (or already linked, or rejected) are skipped, never an error for the whole batch.
   */
  async bulkLink(actor: AuthUser, input: BulkLinkInput): Promise<BulkLinkResult> {
    let linked = 0;
    let skipped = 0;
    for (const id of new Set(input.evidenceIds)) {
      try {
        const item = await this.evidence.get(actor, id);
        if (!item.can.linkMetrics || item.metrics.some((m) => m.metricId === input.metricId)) {
          skipped++;
          continue;
        }
        const links = [
          ...item.metrics.map((m) => ({ metricId: m.metricId, documentKey: m.documentKey })),
          { metricId: input.metricId, documentKey: input.documentKey ?? null },
        ];
        await this.evidence.setMetrics(actor, id, { links });
        linked++;
      } catch (error) {
        // A wrong metric or document fails the same way for every item: report it once.
        const code = (error as { getResponse?: () => { code?: string } }).getResponse?.().code;
        if (code === 'invalid_input' || code === 'choose_document') throw error;
        skipped++;
      }
    }
    return { linked, skipped };
  }

  /**
   * Download links for many items, for a ZIP built in the browser: files go from storage to the browser and
   * never through the API. Items the person may not see are left out.
   */
  async downloadLinks(actor: AuthUser, ids: readonly string[]): Promise<DownloadLink[]> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    const rows = await this.prisma.forTenant(actor.collegeId, (db) =>
      db.evidence.findMany({
        where: { collegeId: actor.collegeId, id: { in: [...new Set(ids)] }, AND: [this.visibleWhere(actor, grants)] },
        select: { id: true, fileKey: true, fileName: true, title: true },
      }),
    );
    if (rows.length === 0) throw apiError(404, 'not_found', 'None of those files can be downloaded.');
    await this.prisma.forTenant(actor.collegeId, (db) =>
      audit(db, actor, 'evidence', rows.map((r) => r.id).join(',').slice(0, 200), 'bulk_download', { after: { count: rows.length } }),
    );
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        fileName: row.fileName,
        url: (await this.storage.presignDownload({ key: row.fileKey, fileName: row.fileName })).url,
      })),
    );
  }

}
