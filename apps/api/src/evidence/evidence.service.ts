import { Injectable } from '@nestjs/common';
import {
  EVIDENCE_STATUS_LABELS,
  type EvidenceCheck,
  type EvidenceDetail,
  type EvidenceMetricLink,
  type EvidenceStage,
  type EvidenceStatus,
  type EvidenceSummary,
  type Grant,
  type MyEvidence,
  type ReviewLevel,
  type ReviewQueue,
  type Role,
  type UploadTicket,
  can,
  departmentsFor,
} from '@yucampus/types';
import type {
  CreateEvidenceInput,
  EvidenceFileType,
  EvidenceMetricsInput,
  ResubmitEvidenceInput,
  ReviewInput,
  UploadRequestInput,
} from '@yucampus/validation';
import { SignJWT, jwtVerify } from 'jose';
import { AccreditationService } from '../accreditation/accreditation.service.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { fromIsoDate, notFound, toIsoDate } from '../common/params.js';
import { AppConfig } from '../config.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';
import { FileStorage, newFileKey } from '../storage/file-storage.js';
import { SIGNATURE_BYTES, TYPE_NAMES, matchesType } from './file-signature.js';

const UPLOAD_AUDIENCE = 'yucampus:evidence-upload';
const UPLOAD_TOKEN_MINUTES = 30;

interface UploadClaims {
  key: string;
  type: EvidenceFileType;
  size: number;
  name: string;
  sha: string | null;
}

const SUMMARY_SELECT = {
  id: true,
  title: true,
  fileName: true,
  fileType: true,
  fileSize: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  uploadedById: true,
  departmentId: true,
  academicYearId: true,
} satisfies Prisma.EvidenceSelect;
type SummaryRow = Prisma.EvidenceGetPayload<{ select: typeof SUMMARY_SELECT }>;

/** Facts about the college needed to work out where each item is in approval. */
interface ApprovalContext {
  levels: 1 | 2;
  /** Head of each department that has one (only they approve at department level). */
  hodOf: Map<string, string>;
  /** Metrics of NBA frameworks: evidence linked to one of these is NBA evidence. */
  nbaMetricIds: Set<string>;
}

/** The parts of an evidence row the approval rules look at. */
type LinkRow = {
  status: EvidenceStatus;
  departmentId: string | null;
  uploadedById: string;
  metrics?: readonly { metricId: string }[];
};

const notAllowed = () => apiError(403, 'forbidden', 'You cannot do this with this evidence.');

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
    private readonly permissions: PermissionsService,
    private readonly config: AppConfig,
    private readonly accreditation: AccreditationService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- Upload

  /** Step 1: approve a file by type and size and return a link the browser uploads it to directly. */
  async requestUpload(actor: AuthUser, input: UploadRequestInput): Promise<UploadTicket> {
    await this.requireUpload(actor);
    const key = newFileKey(actor.collegeId, 'evidence', input.fileName);
    const link = await this.storage.presignUpload({ key, contentType: input.contentType, size: input.size });
    const claims: UploadClaims = { key, type: input.contentType, size: input.size, name: input.fileName, sha: input.sha256 ?? null };
    const uploadToken = await new SignJWT({ ...claims, cid: actor.collegeId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(actor.id)
      .setAudience(UPLOAD_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${UPLOAD_TOKEN_MINUTES}m`)
      .sign(this.config.jwtSecret);
    return { url: link.url, method: 'PUT', headers: link.headers, uploadToken, expiresAt: link.expiresAt };
  }

  /** Step 2: the file is in storage; check it really is what was approved, then create the evidence. */
  async create(actor: AuthUser, input: CreateEvidenceInput): Promise<EvidenceDetail> {
    await this.requireUpload(actor);
    const file = await this.verifyUpload(actor, input.uploadToken);

    const id = await this.prisma.forTenant(actor.collegeId, async (db) => {
      const year = await db.academicYear.findFirst({ where: { collegeId: actor.collegeId, status: 'current' } });
      if (!year) throw apiError(409, 'no_current_year', 'Your college has no current academic year. Ask your college admin.');
      const departmentId = await this.departmentFor(db, actor, input.departmentId ?? null);
      // Uploaded for a task: only by someone the task is for, and it brings the task's metric along.
      const task = input.taskId ? await this.taskFor(db, actor, input.taskId) : null;
      const metricId = input.metricId ?? task?.metricId ?? null;
      const documentKey = input.metricId ? (input.documentKey ?? null) : (task?.documentKey ?? null);

      const evidence = await db.evidence.create({
        data: {
          collegeId: actor.collegeId,
          academicYearId: year.id,
          departmentId,
          uploadedById: actor.id,
          fileKey: file.key,
          fileType: file.type,
          fileSize: file.size,
          fileName: file.name,
          fileSha256: file.sha,
          title: input.title,
          description: input.description ?? null,
          documentDate: input.documentDate ? fromIsoDate(input.documentDate) : null,
          status: 'in_review',
          taskId: task?.id ?? null,
        },
      });
      await db.reviewAction.create({
        data: { collegeId: actor.collegeId, evidenceId: evidence.id, userId: actor.id, action: 'submitted' },
      });
      await db.evidenceVersion.create({
        data: {
          collegeId: actor.collegeId,
          evidenceId: evidence.id,
          version: 1,
          fileKey: file.key,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          uploadedById: actor.id,
        },
      });
      if (metricId) {
        const [link] = await this.checkLinks(db, actor.collegeId, [{ metricId, documentKey }]);
        await db.evidenceMetric.create({ data: { collegeId: actor.collegeId, evidenceId: evidence.id, ...link! } });
      }
      await audit(db, actor, 'evidence', evidence.id, 'upload', { after: { title: input.title, fileName: file.name, departmentId, taskId: task?.id } });
      await this.tellNextReviewers(db, actor.collegeId, { ...evidence, metrics: metricId ? [{ metricId }] : [] });
      return evidence.id;
    });
    return this.get(actor, id);
  }

  /** After "needs fix": the uploader sends corrected details and, if needed, a corrected file. */
  async resubmit(actor: AuthUser, id: string, input: ResubmitEvidenceInput): Promise<EvidenceDetail> {
    const file = input.uploadToken ? await this.verifyUpload(actor, input.uploadToken) : null;
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const before = await db.evidence.findFirst({ where: { id, collegeId: actor.collegeId } });
      if (!before) throw notFound('evidence');
      if (before.uploadedById !== actor.id) throw notAllowed();
      if (before.status !== 'needs_fix') {
        throw apiError(409, 'not_sent_back', 'Only evidence sent back for fixing can be sent again.');
      }
      await db.evidence.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description ?? null,
          documentDate: input.documentDate ? fromIsoDate(input.documentDate) : null,
          status: 'in_review',
          ...(file
            ? { fileKey: file.key, fileType: file.type, fileSize: file.size, fileName: file.name, fileSha256: file.sha, version: { increment: 1 } }
            : {}),
        },
      });
      await db.reviewAction.create({
        data: { collegeId: actor.collegeId, evidenceId: id, userId: actor.id, action: 'resubmitted' },
      });
      // A new file becomes a new version; the earlier files stay in storage and in the version history.
      if (file) {
        await db.evidenceVersion.create({
          data: {
            collegeId: actor.collegeId,
            evidenceId: id,
            version: before.version + 1,
            fileKey: file.key,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            uploadedById: actor.id,
          },
        });
      }
      await this.tellNextReviewers(db, actor.collegeId, { ...before, status: 'in_review', version: file ? before.version + 1 : before.version, title: input.title });
      await audit(db, actor, 'evidence', id, 'resubmit', {
        before: { title: before.title, fileKey: before.fileKey, version: before.version },
        after: { title: input.title, fileKey: file?.key ?? before.fileKey },
      });
    });
    return this.get(actor, id);
  }

  // ---------------------------------------------------------------- Reading

  async mine(actor: AuthUser): Promise<MyEvidence> {
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const where = { collegeId: actor.collegeId, uploadedById: actor.id };
      const [rows, groups, context] = await Promise.all([
        db.evidence.findMany({ where, select: SUMMARY_SELECT, orderBy: { updatedAt: 'desc' }, take: 50 }),
        db.evidence.groupBy({ by: ['status'], where, _count: { _all: true } }),
        this.approvalContext(db, actor.collegeId),
      ]);
      const count = (...statuses: EvidenceStatus[]) =>
        groups.filter((g) => statuses.includes(g.status)).reduce((sum, g) => sum + g._count._all, 0);
      return {
        counts: {
          uploaded: count('in_review', 'department_approved', 'approved', 'needs_fix', 'rejected'),
          approved: count('approved'),
          inReview: count('in_review', 'department_approved'),
          needsFix: count('needs_fix'),
        },
        items: await this.summaries(db, actor.collegeId, rows, context),
      };
    });
  }

  /** Items the person can approve now, oldest first. Never their own uploads. */
  async queue(actor: AuthUser): Promise<ReviewQueue> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const context = await this.approvalContext(db, actor.collegeId);
      const or = this.reviewableWhere(grants, context);
      if (or.length === 0) return { items: [], total: 0 };
      const where: Prisma.EvidenceWhereInput = { collegeId: actor.collegeId, uploadedById: { not: actor.id }, OR: or };
      const [rows, total] = await Promise.all([
        db.evidence.findMany({ where, select: SUMMARY_SELECT, orderBy: { createdAt: 'asc' }, take: 50 }),
        db.evidence.count({ where }),
      ]);
      return { items: await this.summaries(db, actor.collegeId, rows, context), total };
    });
  }

  async get(actor: AuthUser, id: string): Promise<EvidenceDetail> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const row = await db.evidence.findFirst({
        where: { id, collegeId: actor.collegeId },
        select: {
          ...SUMMARY_SELECT,
          description: true,
          documentDate: true,
          fileSha256: true,
          reviewActions: { orderBy: { at: 'asc' }, select: { action: true, level: true, userId: true, comment: true, at: true } },
          metrics: { select: { metricId: true, documentKey: true } },
        },
      });
      if (!row) throw notFound('evidence');
      const context = await this.approvalContext(db, actor.collegeId);
      if (!this.canSee(actor, grants, row, context)) throw notFound('evidence');

      const [summary] = await this.summaries(db, actor.collegeId, [row], context);
      const people = await db.user.findMany({
        where: { collegeId: actor.collegeId, id: { in: [...new Set(row.reviewActions.map((a) => a.userId))] } },
        select: { id: true, name: true },
      });
      const nameOf = new Map(people.map((p) => [p.id, p.name]));
      return {
        ...summary!,
        description: row.description,
        documentDate: row.documentDate ? toIsoDate(row.documentDate) : null,
        history: row.reviewActions.map((action) => ({
          action: action.action,
          level: action.level,
          by: nameOf.get(action.userId) ?? 'Someone',
          comment: action.comment,
          at: action.at.toISOString(),
        })),
        checks: await this.checks(db, actor.collegeId, row),
        metrics: await this.describeLinks(db, row.metrics),
        can: {
          review: row.uploadedById === actor.id ? null : this.levelFor(grants, row, context),
          resubmit: row.uploadedById === actor.id && row.status === 'needs_fix',
          linkMetrics: this.canLink(actor, grants, row, context),
        },
      };
    });
  }

  /** A short-lived link to view (inline) or download the file. */
  async fileLink(actor: AuthUser, id: string, inline: boolean) {
    const detail = await this.get(actor, id); // Applies the same visibility rules.
    const key = await this.prisma.forTenant(actor.collegeId, async (db) => {
      const row = await db.evidence.findFirstOrThrow({ where: { id, collegeId: actor.collegeId }, select: { fileKey: true } });
      return row.fileKey;
    });
    return this.storage.presignDownload({ key, fileName: detail.fileName, inline });
  }

  /** Summaries of the given items, in the given order (for the library). Visibility is the caller's job. */
  async summariesFor(db: TenantClient, collegeId: string, ids: readonly string[]): Promise<EvidenceSummary[]> {
    if (ids.length === 0) return [];
    const [rows, context] = await Promise.all([
      db.evidence.findMany({ where: { collegeId, id: { in: [...ids] } }, select: SUMMARY_SELECT }),
      this.approvalContext(db, collegeId),
    ]);
    const order = new Map(ids.map((id, index) => [id, index]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return this.summaries(db, collegeId, rows, context);
  }

  // ---------------------------------------------------------------- Review

  async review(actor: AuthUser, id: string, input: ReviewInput & { decision: 'approve' | 'needs_fix' | 'reject' }): Promise<EvidenceDetail> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const row = await db.evidence.findFirst({
        where: { id, collegeId: actor.collegeId },
        select: { ...SUMMARY_SELECT, documentDate: true, metrics: { select: { metricId: true, documentKey: true } } },
      });
      if (!row) throw notFound('evidence');
      const context = await this.approvalContext(db, actor.collegeId);
      if (!this.canSee(actor, grants, row, context)) throw notFound('evidence');
      if (row.uploadedById === actor.id) {
        throw apiError(403, 'own_upload', 'You cannot approve your own upload. Someone else must review it.');
      }
      const level = this.levelFor(grants, row, context);
      if (!level) {
        const stage = this.stageOf(row, context);
        throw apiError(
          409,
          'not_your_turn',
          stage.waitingFor ? `This is waiting for ${stage.waitingFor === 'department' ? 'the HOD' : 'final approval'}.` : `This is already ${stage.label.toLowerCase()}.`,
        );
      }

      const status: EvidenceStatus =
        input.decision === 'approve' ? (level === 'department' ? 'department_approved' : 'approved') : input.decision === 'needs_fix' ? 'needs_fix' : 'rejected';
      await db.evidence.update({
        where: { id },
        data: {
          status,
          ...(input.decision === 'approve' && input.title ? { title: input.title } : {}),
          ...(input.decision === 'approve' && input.documentDate !== undefined
            ? { documentDate: input.documentDate ? fromIsoDate(input.documentDate) : null }
            : {}),
        },
      });
      await db.reviewAction.create({
        data: {
          collegeId: actor.collegeId,
          evidenceId: id,
          userId: actor.id,
          level,
          action: input.decision === 'approve' ? 'approved' : input.decision === 'needs_fix' ? 'needs_fix' : 'rejected',
          comment: input.comment ?? null,
        },
      });
      await audit(db, actor, 'evidence', id, `review_${input.decision}`, {
        before: { status: row.status, title: row.title },
        after: { status, level, title: input.title ?? row.title, comment: input.comment ?? null },
      });

      const title = input.title ?? row.title;
      const link = `/evidence/${id}`;
      if (status === 'department_approved') {
        await this.tellNextReviewers(db, actor.collegeId, { ...row, status });
      } else if (status === 'approved') {
        // Final approval of evidence uploaded for a task completes the task.
        const task = await db.evidence.findUniqueOrThrow({ where: { id }, select: { taskId: true } });
        if (task.taskId) {
          await db.task.updateMany({
            where: { id: task.taskId, collegeId: actor.collegeId, status: { not: 'done' } },
            data: { status: 'done', completedAt: new Date() },
          });
        }
        await this.notifications.notify(db, {
          collegeId: actor.collegeId,
          userIds: [row.uploadedById],
          kind: 'evidence_approved',
          text: `Approved: “${title}” now counts towards readiness`,
          link,
          dedupeKey: `evidence:${id}:approved:v${row.version}`,
        });
      } else {
        await this.notifications.notify(db, {
          collegeId: actor.collegeId,
          userIds: [row.uploadedById],
          kind: status === 'needs_fix' ? 'evidence_needs_fix' : 'evidence_rejected',
          text:
            status === 'needs_fix'
              ? `Sent back to fix: “${title}”: ${input.comment ?? ''}`.trim()
              : `Rejected: “${title}”: ${input.comment ?? ''}`.trim(),
          link,
        });
      }
    });
    return this.get(actor, id);
  }

  /** The task an upload is for, if the person is one of the people it is for and it is still open. */
  private async taskFor(db: TenantClient, actor: AuthUser, taskId: string) {
    const task = await db.task.findFirst({ where: { id: taskId, collegeId: actor.collegeId } });
    if (!task) throw notFound('task');
    const myDepartments = actor.roles.filter((r) => r.role === 'faculty' || r.role === 'hod').map((r) => r.departmentId);
    const forMe = task.assigneeUserId === actor.id || (task.assigneeDepartmentId !== null && myDepartments.includes(task.assigneeDepartmentId));
    if (!forMe) throw apiError(403, 'forbidden', 'This task is not yours.');
    if (task.status === 'done') throw apiError(409, 'task_done', 'This task is already done.');
    return task;
  }

  /** Tells whoever approves next that an item is waiting for them (HOD, or the final approvers). */
  private async tellNextReviewers(
    db: TenantClient,
    collegeId: string,
    row: { id: string; title: string; status: EvidenceStatus; departmentId: string | null; uploadedById: string; version: number; metrics?: readonly { metricId: string }[] },
  ) {
    const context = await this.approvalContext(db, collegeId);
    const waitingFor = this.stageOf(row, context).waitingFor;
    if (!waitingFor) return;
    let reviewers: string[] = [];
    if (waitingFor === 'department') {
      const hod = row.departmentId ? context.hodOf.get(row.departmentId) : undefined;
      reviewers = hod ? [hod] : [];
    } else {
      const people = await db.userRole.findMany({ where: { collegeId }, select: { userId: true, role: true, departmentId: true } });
      const byUser = new Map<string, { role: Role; departmentId: string | null }[]>();
      for (const p of people) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), { role: p.role, departmentId: p.departmentId }]);
      for (const [userId, roles] of byUser) {
        const grants = await this.permissions.grantsFor(collegeId, roles, db);
        if (this.levelFor(grants, row, context) === 'final') reviewers.push(userId);
      }
    }
    await this.notifications.notify(db, {
      collegeId,
      userIds: reviewers.filter((userId) => userId !== row.uploadedById),
      kind: 'review_waiting',
      text: `Waiting for your ${waitingFor === 'department' ? 'department' : 'final'} approval: “${row.title}”`,
      link: '/review',
      dedupeKey: `review:${row.id}:${waitingFor}:v${row.version}`,
    });
  }

  /**
   * Which metrics the evidence counts for (and which required document it is). The uploader can change this
   * until it is approved; reviewers when it is their turn; final approvers at any time (e.g. to correct it).
   */
  async setMetrics(actor: AuthUser, id: string, input: EvidenceMetricsInput): Promise<EvidenceDetail> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const row = await db.evidence.findFirst({
        where: { id, collegeId: actor.collegeId },
        select: { ...SUMMARY_SELECT, metrics: { select: { metricId: true, documentKey: true } } },
      });
      if (!row) throw notFound('evidence');
      const context = await this.approvalContext(db, actor.collegeId);
      if (!this.canSee(actor, grants, row, context)) throw notFound('evidence');
      if (!this.canLink(actor, grants, row, context)) throw notAllowed();

      const links = await this.checkLinks(db, actor.collegeId, input.links);
      await db.evidenceMetric.deleteMany({ where: { collegeId: actor.collegeId, evidenceId: id } });
      if (links.length) {
        await db.evidenceMetric.createMany({ data: links.map((link) => ({ collegeId: actor.collegeId, evidenceId: id, ...link })) });
      }
      await db.reviewAction.create({
        data: {
          collegeId: actor.collegeId,
          evidenceId: id,
          userId: actor.id,
          action: 'remapped',
          level: row.uploadedById === actor.id ? null : this.levelFor(grants, row, context),
        },
      });
      await audit(db, actor, 'evidence', id, 'link_metrics', { before: row.metrics, after: links });
    });
    return this.get(actor, id);
  }

  // ---------------------------------------------------------------- Rules

  /**
   * Checks links against the frameworks the college works against now, and fills in the document when the
   * metric needs only one. A metric needing several documents must say which one this is.
   */
  private async checkLinks(
    db: TenantClient,
    collegeId: string,
    links: readonly { metricId: string; documentKey?: string | null }[],
  ): Promise<{ metricId: string; documentKey: string | null }[]> {
    if (links.length === 0) return [];
    const active = await this.accreditation.activeFrameworkIds(db, collegeId);
    const metrics = await db.metric.findMany({
      where: { id: { in: links.map((l) => l.metricId) }, criterion: { frameworkId: { in: active } } },
      select: { id: true, code: true, requiredDocuments: true },
    });
    const byId = new Map(metrics.map((m) => [m.id, m]));
    return links.map(({ metricId, documentKey }) => {
      const metric = byId.get(metricId);
      if (!metric) throw apiError(400, 'invalid_input', 'That metric is not part of a framework your college works against.');
      const documents = (Array.isArray(metric.requiredDocuments) ? metric.requiredDocuments : []) as { key: string }[];
      if (documentKey) {
        if (!documents.some((d) => d.key === documentKey)) {
          throw apiError(400, 'invalid_input', `Metric ${metric.code} does not need that document.`);
        }
        return { metricId, documentKey };
      }
      if (documents.length === 1) return { metricId, documentKey: documents[0]!.key };
      throw apiError(400, 'choose_document', `Choose which document of metric ${metric.code} this is.`);
    });
  }

  private canLink(actor: AuthUser, grants: readonly Grant[], row: LinkRow, context: ApprovalContext): boolean {
    if (row.status === 'rejected') return false;
    if (can(grants, 'evidence.approve_final', ['college'])) return true;
    if (row.uploadedById === actor.id) return row.status !== 'approved';
    return this.levelFor(grants, row, context) !== null;
  }

  private async describeLinks(db: TenantClient, links: readonly { metricId: string; documentKey: string | null }[]): Promise<EvidenceMetricLink[]> {
    if (links.length === 0) return [];
    const metrics = await db.metric.findMany({
      where: { id: { in: links.map((l) => l.metricId) } },
      select: {
        id: true,
        code: true,
        name: true,
        requiredDocuments: true,
        criterion: { select: { number: true, framework: { select: { body: true } } } },
      },
    });
    const byId = new Map(metrics.map((m) => [m.id, m]));
    return links.flatMap((link) => {
      const metric = byId.get(link.metricId);
      if (!metric) return [];
      const documents = (Array.isArray(metric.requiredDocuments) ? metric.requiredDocuments : []) as { key: string; name: string }[];
      return [
        {
          metricId: metric.id,
          code: metric.code,
          name: metric.name,
          body: metric.criterion.framework.body,
          criterionNumber: metric.criterion.number,
          documentKey: link.documentKey,
          documentName: documents.find((d) => d.key === link.documentKey)?.name ?? null,
        },
      ];
    });
  }

  private async requireUpload(actor: AuthUser) {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    if (!can(grants, 'evidence.upload')) {
      throw apiError(403, 'forbidden', 'Your role cannot upload evidence. Ask your college admin if you need to.');
    }
  }

  private async verifyUpload(actor: AuthUser, token: string): Promise<UploadClaims> {
    let claims: UploadClaims & { cid?: unknown };
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, { audience: UPLOAD_AUDIENCE, subject: actor.id, algorithms: ['HS256'] });
      claims = payload as unknown as UploadClaims & { cid?: unknown };
    } catch {
      throw apiError(400, 'upload_expired', 'This upload has expired. Please choose the file again.');
    }
    if (claims.cid !== actor.collegeId || !claims.key.startsWith(`colleges/${actor.collegeId}/`)) {
      throw apiError(400, 'upload_expired', 'This upload has expired. Please choose the file again.');
    }

    const stored = await this.storage.inspect(claims.key);
    if (!stored) throw apiError(409, 'upload_missing', 'The file did not finish uploading. Please try again.');
    const fail = async (message: string) => {
      await this.storage.remove(claims.key).catch(() => undefined);
      return apiError(422, 'file_rejected', message);
    };
    if (stored.size !== claims.size) throw await fail('The file changed while uploading. Please try again.');
    if (!matchesType(await this.storage.readStart(claims.key, SIGNATURE_BYTES), claims.type)) {
      throw await fail(`This file is not really a ${TYPE_NAMES[claims.type]}. Save it again in that format, or as a PDF.`);
    }
    return claims;
  }

  /** The uploader's department for this evidence: one they belong to, or none for college-wide roles. */
  private async departmentFor(db: TenantClient, actor: AuthUser, requested: string | null): Promise<string | null> {
    const own = [...new Set(actor.roles.map((role) => role.departmentId).filter((d): d is string => Boolean(d)))];
    if (requested) {
      if (!own.includes(requested)) throw apiError(403, 'forbidden', 'You can upload only for your own department.');
      const exists = await db.department.findFirst({ where: { id: requested, collegeId: actor.collegeId } });
      if (!exists) throw notFound('department');
      return requested;
    }
    return own[0] ?? null;
  }

  private async approvalContext(db: TenantClient, collegeId: string): Promise<ApprovalContext> {
    const [college, hods, nbaMetrics] = await Promise.all([
      db.college.findUniqueOrThrow({ where: { id: collegeId }, select: { settings: true } }),
      db.userRole.findMany({ where: { collegeId, role: 'hod' }, select: { departmentId: true, userId: true } }),
      db.metric.findMany({ where: { criterion: { framework: { body: 'NBA' } } }, select: { id: true } }),
    ]);
    const settings = college.settings as { approvalLevels?: number } | null;
    return {
      levels: settings?.approvalLevels === 1 ? 1 : 2,
      hodOf: new Map(hods.filter((h) => h.departmentId).map((h) => [h.departmentId!, h.userId])),
      nbaMetricIds: new Set(nbaMetrics.map((m) => m.id)),
    };
  }

  /**
   * Where an item is. With two levels, an item from a department that has a head waits for that head first;
   * everything else (one level, no department, no head yet, or the head's own upload) goes straight to final
   * approval, so nothing gets stuck waiting for a person who does not exist or may not approve it.
   */
  private stageOf(row: { status: EvidenceStatus; departmentId: string | null; uploadedById: string }, context: ApprovalContext): EvidenceStage {
    const hod = row.departmentId ? context.hodOf.get(row.departmentId) : undefined;
    const needsHod = context.levels === 2 && hod !== undefined && hod !== row.uploadedById;
    switch (row.status) {
      case 'in_review':
        return needsHod
          ? { status: row.status, waitingFor: 'department', label: 'Waiting for HOD' }
          : { status: row.status, waitingFor: 'final', label: 'Waiting for final approval' };
      case 'department_approved':
        return { status: row.status, waitingFor: 'final', label: 'Approved by HOD, waiting for final approval' };
      default:
        return { status: row.status, waitingFor: null, label: EVIDENCE_STATUS_LABELS[row.status] };
    }
  }

  /** The approval level at which this person may act on the item now, if any. */
  private levelFor(
    grants: readonly Grant[],
    row: LinkRow,
    context: ApprovalContext,
  ): ReviewLevel | null {
    const waitingFor = this.stageOf(row, context).waitingFor;
    if (waitingFor === 'department') {
      return row.departmentId && departmentsFor(grants, 'evidence.approve_department').includes(row.departmentId) ? 'department' : null;
    }
    if (waitingFor === 'final') {
      if (can(grants, 'evidence.approve_final', ['college'])) return 'final';
      // NBA coordinators give final approval to NBA evidence only: items linked to an NBA metric.
      const isNba = row.metrics?.some((link) => context.nbaMetricIds.has(link.metricId)) ?? false;
      return isNba && can(grants, 'evidence.approve_final', ['nba']) ? 'final' : null;
    }
    return null;
  }

  /** Database filter for items waiting for this person, matching levelFor. */
  private reviewableWhere(grants: readonly Grant[], context: ApprovalContext): Prisma.EvidenceWhereInput[] {
    const or: Prisma.EvidenceWhereInput[] = [];
    const withHod = [...context.hodOf.keys()];
    const ownDepartments = departmentsFor(grants, 'evidence.approve_department').filter((d) => context.hodOf.has(d));
    if (context.levels === 2) {
      // Waiting for the head: their department, not uploaded by the head themselves.
      for (const departmentId of ownDepartments) {
        or.push({ status: 'in_review', departmentId, uploadedById: { not: context.hodOf.get(departmentId) } });
      }
    }
    // Waiting for final approval: approved by the HOD, or not needing the HOD at all.
    const finalStage: Prisma.EvidenceWhereInput = {
      OR: [
        { status: 'department_approved' },
        context.levels === 1
          ? { status: 'in_review' }
          : {
              status: 'in_review',
              OR: [
                { departmentId: null },
                { departmentId: { notIn: withHod } },
                ...withHod.map((departmentId) => ({ departmentId, uploadedById: context.hodOf.get(departmentId) })),
              ],
            },
      ],
    };
    if (can(grants, 'evidence.approve_final', ['college'])) {
      or.push(finalStage);
    } else if (can(grants, 'evidence.approve_final', ['nba'])) {
      or.push({ AND: [finalStage, { metrics: { some: { metricId: { in: [...context.nbaMetricIds] } } } }] });
    }
    return or;
  }

  /** Uploader, anyone who reviews at either level for it, and people with college-wide dashboards. */
  private canSee(actor: AuthUser, grants: readonly Grant[], row: { uploadedById: string; departmentId: string | null }, _context: ApprovalContext): boolean {
    if (row.uploadedById === actor.id) return true;
    if (can(grants, 'evidence.approve_final', ['college']) || can(grants, 'dashboards.view', ['college'])) return true;
    const departments = [...departmentsFor(grants, 'evidence.approve_department'), ...departmentsFor(grants, 'dashboards.view')];
    return row.departmentId !== null && departments.includes(row.departmentId);
  }

  private async summaries(db: TenantClient, collegeId: string, rows: SummaryRow[], context: ApprovalContext): Promise<EvidenceSummary[]> {
    const [people, departments, years] = await Promise.all([
      db.user.findMany({ where: { collegeId, id: { in: [...new Set(rows.map((r) => r.uploadedById))] } }, select: { id: true, name: true } }),
      db.department.findMany({ where: { collegeId }, select: { id: true, code: true } }),
      db.academicYear.findMany({ where: { collegeId }, select: { id: true, label: true } }),
    ]);
    const person = new Map(people.map((p) => [p.id, p]));
    const department = new Map(departments.map((d) => [d.id, d]));
    const year = new Map(years.map((y) => [y.id, y.label]));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      fileName: row.fileName,
      fileType: row.fileType,
      fileSize: row.fileSize,
      status: row.status,
      stage: this.stageOf(row, context),
      version: row.version,
      uploadedAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      uploadedBy: person.get(row.uploadedById) ?? { id: row.uploadedById, name: 'Unknown' },
      department: row.departmentId ? (department.get(row.departmentId) ?? null) : null,
      academicYear: year.get(row.academicYearId) ?? '',
    }));
  }

  /** Automatic checks for the reviewer. They inform; the reviewer decides. */
  private async checks(
    db: TenantClient,
    collegeId: string,
    row: { id: string; fileType: string; fileSize: number; fileSha256: string | null; documentDate: Date | null; academicYearId: string },
  ): Promise<EvidenceCheck[]> {
    const checks: EvidenceCheck[] = [];
    const typeName = TYPE_NAMES[row.fileType as EvidenceFileType] ?? 'file';
    const size = row.fileSize < 1024 * 1024 ? `${Math.max(1, Math.round(row.fileSize / 1024))} KB` : `${(row.fileSize / 1024 / 1024).toFixed(1)} MB`;
    checks.push({ key: 'file', ok: true, text: `File checked: a real ${typeName}, ${size}` });

    if (row.fileSha256) {
      const twin = await db.evidence.findFirst({
        where: { collegeId, fileSha256: row.fileSha256, id: { not: row.id }, status: { not: 'rejected' } },
        select: { title: true },
      });
      checks.push(
        twin
          ? { key: 'duplicate', ok: false, text: `The same file is already in the evidence library as "${twin.title}"` }
          : { key: 'duplicate', ok: true, text: 'No duplicate found in the evidence library' },
      );
    }

    const year = await db.academicYear.findFirst({ where: { id: row.academicYearId, collegeId } });
    if (!row.documentDate) {
      checks.push({ key: 'date', ok: false, text: 'No document date given; check the date on the document' });
    } else if (year && (row.documentDate < year.startDate || row.documentDate > year.endDate)) {
      checks.push({ key: 'date', ok: false, text: `The document date ${toIsoDate(row.documentDate)} is outside academic year ${year.label}` });
    } else if (year) {
      checks.push({ key: 'date', ok: true, text: `Date falls within academic year ${year.label}` });
    }
    return checks;
  }
}
