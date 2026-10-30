import { Injectable } from '@nestjs/common';
import {
  type DashboardActivity,
  type DashboardDepartment,
  type DashboardNaac,
  type DashboardView,
  can,
  departmentsFor,
} from '@yucampus/types';
import { AccreditationService } from '../accreditation/accreditation.service.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { notFound, toIsoDate } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { indiaNow } from '../notifications/notifications.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';

const DAY = 24 * 60 * 60 * 1000;
const PENDING = ['in_review', 'department_approved'] as const;
const ACTIVITY_ACTIONS = ['upload', 'resubmit', 'review_approve', 'review_needs_fix', 'review_reject', 'create', 'create_from_gaps'];

/** Whose numbers the dashboard shows: the whole college, or (HOD) only these departments. */
type Scope = { college: true } | { college: false; departments: string[] };

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly accreditation: AccreditationService,
  ) {}

  async view(actor: AuthUser, yearId?: string): Promise<DashboardView> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    const scope: Scope | null = can(grants, 'dashboards.view', ['college'])
      ? { college: true }
      : departmentsFor(grants, 'dashboards.view').length
        ? { college: false, departments: departmentsFor(grants, 'dashboards.view') }
        : null;
    if (!scope) throw apiError(403, 'forbidden', 'The college dashboard is for the principal, IQAC and heads of department.');

    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const collegeId = actor.collegeId;
      const years = await db.academicYear.findMany({
        where: { collegeId },
        select: { id: true, label: true, status: true },
        orderBy: { startDate: 'desc' },
      });
      const year = yearId ? years.find((y) => y.id === yearId) : (years.find((y) => y.status === 'current') ?? years[0]);
      if (!year) throw yearId ? notFound('academic year') : apiError(409, 'no_current_year', 'Your college has no academic year yet.');

      const inScope: Prisma.EvidenceWhereInput = scope.college ? {} : { departmentId: { in: scope.departments } };
      const weekAgo = new Date(Date.now() - 7 * DAY);
      const [uploaded, thisWeek, approved, pending, oldest] = await Promise.all([
        db.evidence.count({ where: { collegeId, academicYearId: year.id, ...inScope } }),
        db.evidence.count({ where: { collegeId, academicYearId: year.id, createdAt: { gte: weekAgo }, ...inScope } }),
        db.evidence.count({ where: { collegeId, academicYearId: year.id, status: 'approved', ...inScope } }),
        db.evidence.count({ where: { collegeId, status: { in: [...PENDING] }, ...inScope } }),
        db.evidence.findFirst({
          where: { collegeId, status: { in: [...PENDING] }, ...inScope },
          orderBy: { updatedAt: 'asc' },
          select: { updatedAt: true },
        }),
      ]);

      return {
        scope: scope.college ? 'college' : 'department',
        academicYear: { id: year.id, label: year.label },
        years,
        naac: await this.naac(db, collegeId),
        evidence: { uploaded, thisWeek, approved },
        review: { pending, oldestDays: oldest ? Math.floor((Date.now() - oldest.updatedAt.getTime()) / DAY) : null },
        deadlines: await this.deadlines(db, collegeId),
        programs: await this.programs(db, collegeId, scope),
        departments: await this.departments(db, collegeId, year.id, scope),
        activity: await this.activity(db, collegeId, scope),
      };
    });
  }

  /** NAAC readiness now and 30 days ago, from the same calculation as the NAAC pages. */
  private async naac(db: TenantClient, collegeId: string): Promise<DashboardNaac | null> {
    const now = await this.accreditation.computeOverview(db, collegeId, 'NAAC');
    if (!now) return null;
    const anyApproval = await db.reviewAction.count({ where: { collegeId, action: 'approved', level: 'final' } });
    const then = anyApproval
      ? await this.accreditation.computeOverview(db, collegeId, 'NAAC', now.framework.id, new Date(Date.now() - 30 * DAY))
      : null;
    const loaded = now.criteria.filter((c) => !c.pending);
    return {
      frameworkId: now.framework.id,
      frameworkName: now.framework.name,
      verified: now.framework.verified,
      percent: now.percent,
      status: now.status,
      change: then ? now.percent - then.percent : null,
      missingDocuments: loaded.reduce((sum, c) => sum + c.missing, 0),
      metricsWithGaps: loaded.reduce((sum, c) => sum + (c.metricsTotal - c.metricsComplete), 0),
      criteria: now.criteria.map(({ number, name, percent, status, pending }) => ({ number, name, percent, status, pending })),
    };
  }

  /** The college's coming key dates (Academic year and calendar). */
  private async deadlines(db: TenantClient, collegeId: string) {
    const today = indiaNow().date;
    const rows = await db.keyDate.findMany({
      where: { collegeId, date: { gte: new Date(`${today}T00:00:00Z`) } },
      orderBy: { date: 'asc' },
      take: 4,
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      date: toIsoDate(row.date),
      daysLeft: Math.round((row.date.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY),
    }));
  }

  /** Programs and the NBA format chosen for each. NBA tracking itself comes in a later phase. */
  private async programs(db: TenantClient, collegeId: string, scope: Scope) {
    const rows = await db.program.findMany({
      where: { collegeId, ...(scope.college ? {} : { departmentId: { in: scope.departments } }) },
      include: {
        department: { select: { code: true } },
        frameworks: { where: { active: true, framework: { body: 'NBA' } }, include: { framework: { select: { name: true } } } },
      },
      orderBy: [{ department: { code: 'asc' } }, { name: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      departmentCode: row.department.code,
      nbaFormat: row.frameworks[0]?.framework.name.replace(/^NBA · /, '') ?? null,
    }));
  }

  private async departments(db: TenantClient, collegeId: string, yearId: string, scope: Scope): Promise<DashboardDepartment[]> {
    const departments = await db.department.findMany({
      where: { collegeId, ...(scope.college ? {} : { id: { in: scope.departments } }) },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const ids = departments.map((d) => d.id);
    const [uploads, pending, roles, uploaders, tasks] = await Promise.all([
      db.evidence.groupBy({ by: ['departmentId'], where: { collegeId, academicYearId: yearId, departmentId: { in: ids } }, _count: { _all: true } }),
      db.evidence.groupBy({
        by: ['departmentId'],
        where: { collegeId, status: { in: [...PENDING] }, departmentId: { in: ids } },
        _count: { _all: true },
      }),
      db.userRole.findMany({ where: { collegeId, departmentId: { in: ids } }, select: { userId: true, role: true, departmentId: true } }),
      db.evidence.findMany({ where: { collegeId, academicYearId: yearId }, select: { uploadedById: true }, distinct: ['uploadedById'] }),
      db.task.findMany({
        where: { collegeId, academicYearId: yearId },
        select: { status: true, assigneeUserId: true, assigneeDepartmentId: true },
      }),
    ]);
    const countOf = (rows: { departmentId: string | null; _count: { _all: number } }[], id: string) =>
      rows.find((r) => r.departmentId === id)?._count._all ?? 0;
    const uploadedSet = new Set(uploaders.map((u) => u.uploadedById));

    return departments.map((department) => {
      const people = new Set(roles.filter((r) => r.departmentId === department.id).map((r) => r.userId));
      const faculty = new Set(roles.filter((r) => r.departmentId === department.id && r.role === 'faculty').map((r) => r.userId));
      const mine = tasks.filter(
        (t) => t.assigneeDepartmentId === department.id || (t.assigneeUserId !== null && people.has(t.assigneeUserId)),
      );
      const done = mine.filter((t) => t.status === 'done').length;
      return {
        id: department.id,
        code: department.code,
        name: department.name,
        uploaded: countOf(uploads, department.id),
        inReview: countOf(pending, department.id),
        openTasks: mine.length - done,
        faculty: faculty.size,
        facultyYetToUpload: [...faculty].filter((id) => !uploadedSet.has(id)).length,
        tasksPercent: mine.length ? Math.round((done / mine.length) * 100) : null,
      };
    });
  }

  /** The latest uploads, review decisions and tasks, from the audit log. A HOD sees their departments' evidence only. */
  private async activity(db: TenantClient, collegeId: string, scope: Scope): Promise<DashboardActivity[]> {
    const rows = await db.auditLog.findMany({
      where: {
        collegeId,
        OR: [
          { entity: 'evidence', action: { in: ACTIVITY_ACTIONS } },
          ...(scope.college ? [{ entity: 'task', action: { in: ['create', 'create_from_gaps'] } }] : []),
        ],
      },
      orderBy: { at: 'desc' },
      take: 40,
    });
    const evidenceIds = rows.filter((r) => r.entity === 'evidence').map((r) => r.entityId);
    const [evidence, users, departments] = await Promise.all([
      db.evidence.findMany({
        where: { collegeId, id: { in: evidenceIds }, ...(scope.college ? {} : { departmentId: { in: scope.departments } }) },
        select: { id: true, title: true, departmentId: true },
      }),
      db.user.findMany({
        where: { collegeId, id: { in: [...new Set(rows.map((r) => r.userId).filter((id): id is string => Boolean(id)))] } },
        select: { id: true, name: true },
      }),
      db.department.findMany({ where: { collegeId }, select: { id: true, code: true } }),
    ]);
    const item = new Map(evidence.map((e) => [e.id, e]));
    const codeOf = new Map(departments.map((d) => [d.id, d.code]));
    const nameOf = new Map(users.map((u) => [u.id, u.name]));

    const out: DashboardActivity[] = [];
    for (const row of rows) {
      const who = (row.userId && nameOf.get(row.userId)) ?? 'Someone';
      const after = (row.after ?? {}) as { title?: string; level?: string; count?: number };
      if (row.entity === 'evidence') {
        const e = item.get(row.entityId);
        if (!e) continue; // Outside a HOD's departments, or deleted.
        const what = `“${e.title}”`;
        const base = { id: row.id, at: row.at.toISOString(), link: `/evidence/${e.id}` };
        if (row.action === 'upload') out.push({ ...base, kind: 'upload', text: `${who}${e.departmentId && codeOf.has(e.departmentId) ? ` (${codeOf.get(e.departmentId)})` : ''} uploaded ${what}` });
        else if (row.action === 'resubmit') out.push({ ...base, kind: 'upload', text: `${who} sent a corrected ${what}` });
        else if (row.action === 'review_approve')
          out.push({ ...base, kind: 'approved', text: `${who} ${after.level === 'department' ? 'approved for the department' : 'gave final approval to'} ${what}` });
        else out.push({ ...base, kind: 'sent_back', text: `${who} ${row.action === 'review_reject' ? 'rejected' : 'sent back'} ${what}` });
      } else if (row.action === 'create_from_gaps') {
        out.push({ id: row.id, at: row.at.toISOString(), link: '/tasks', kind: 'task', text: `${who} created ${after.count ?? 'several'} tasks for missing NAAC documents` });
      } else {
        out.push({ id: row.id, at: row.at.toISOString(), link: `/tasks?task=${row.entityId}`, kind: 'task', text: `${who} assigned “${after.title ?? 'a task'}”` });
      }
      if (out.length === 8) break;
    }
    return out;
  }
}
