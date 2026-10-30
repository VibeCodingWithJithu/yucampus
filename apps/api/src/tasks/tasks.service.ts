import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type GapTasksResult,
  type Grant,
  ROLE_LABELS,
  type Role,
  type TaskAssignees,
  type TaskBoard,
  type TaskReminders,
  type TaskRepeat,
  type TaskStage,
  type TaskView,
  can,
  departmentsFor,
} from '@yucampus/types';
import { type GapTasksInput, REMINDER_RULES, type TaskValues, gapTasksSchema } from '@yucampus/validation';
import { AccreditationService } from '../accreditation/accreditation.service.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { fromIsoDate, notFound, toIsoDate } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Jobs } from '../jobs/jobs.js';
import { NotificationsService, indiaNow } from '../notifications/notifications.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';

type TaskRow = Prisma.TaskGetPayload<{ include: { metric: { include: { criterion: { include: { framework: true } } } } } }>;

/** Whom the actor may give tasks to: anyone in the college, or people and departments of their own departments. */
type AssignScope = { college: true } | { college: false; departments: string[] };

const DAY = 24 * 60 * 60 * 1000;
const addDays = (date: string, days: number) => toIsoDate(new Date(fromIsoDate(date).getTime() + days * DAY));
const formatDay = (date: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(fromIsoDate(date));

/** The next due date of a repeating task. Months are calendar months; a 31st becomes the month's last day. */
export function nextDue(due: string, every: Exclude<TaskRepeat, 'none'>): string {
  const months = every === 'month' ? 1 : every === 'semester' ? 6 : 12;
  const [y, m, d] = due.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return toIsoDate(target);
}

const remindersOf = (rule: Prisma.JsonValue): TaskReminders => {
  const value = rule as { preset?: TaskReminders } | null;
  return value?.preset && value.preset in REMINDER_RULES ? value.preset : 'three_days';
};
const repeatOf = (rule: Prisma.JsonValue): TaskRepeat => {
  const value = rule as { every?: TaskRepeat } | null;
  return value?.every ?? 'none';
};

@Injectable()
export class TasksService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly accreditation: AccreditationService,
    private readonly jobs: Jobs,
  ) {}

  onModuleInit() {
    this.jobs.register('tasks.sweep', async () => {
      await this.sweep();
    });
  }

  // ---------------------------------------------------------------- Board

  async board(actor: AuthUser): Promise<TaskBoard> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const where = await this.visibleWhere(db, actor, grants);
      const rows = await db.task.findMany({
        where: { collegeId: actor.collegeId, AND: [where] },
        include: { metric: { include: { criterion: { include: { framework: true } } } } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        take: 500,
      });
      const tasks = await this.views(db, actor, grants, rows);
      // Done tasks stay on the board for 60 days, then live only in history.
      const cutoff = Date.now() - 60 * DAY;
      const shown = tasks.filter((task) => task.stage !== 'approved' || rows.find((r) => r.id === task.id)!.updatedAt.getTime() > cutoff);
      return { tasks: shown, overdue: shown.filter((t) => t.overdue).length };
    });
  }

  async get(actor: AuthUser, id: string): Promise<TaskView> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const row = await db.task.findFirst({
        where: { id, collegeId: actor.collegeId, AND: [await this.visibleWhere(db, actor, grants)] },
        include: { metric: { include: { criterion: { include: { framework: true } } } } },
      });
      if (!row) throw notFound('task');
      return (await this.views(db, actor, grants, [row]))[0]!;
    });
  }

  /** The departments and people the task form offers. Empty for someone who cannot give tasks. */
  async assignees(actor: AuthUser): Promise<TaskAssignees> {
    const scope = this.assignScope(await this.permissions.grantsFor(actor.collegeId, actor.roles));
    if (!scope) return { departments: [], people: [] };
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const departments = await db.department.findMany({
        where: { collegeId: actor.collegeId, ...(scope.college ? {} : { id: { in: scope.departments } }) },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      });
      const code = new Map(departments.map((d) => [d.id, d.code]));
      const users = await db.user.findMany({
        where: {
          collegeId: actor.collegeId,
          ...(scope.college ? {} : { roles: { some: { departmentId: { in: scope.departments } } } }),
        },
        select: { id: true, name: true, roles: { select: { role: true, departmentId: true } } },
        orderBy: { name: 'asc' },
        take: 2000,
      });
      return {
        departments,
        people: users.map((user) => ({
          id: user.id,
          name: user.name,
          detail: user.roles
            .map((r) => `${ROLE_LABELS[r.role as Role]}${r.departmentId && code.get(r.departmentId) ? `, ${code.get(r.departmentId)}` : ''}`)
            .join(' · '),
        })),
      };
    });
  }

  // ---------------------------------------------------------------- Changes

  async create(actor: AuthUser, input: TaskValues): Promise<TaskView> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    const scope = this.assignScope(grants);
    const id = await this.prisma.forTenant(actor.collegeId, async (db) => {
      await this.checkAssignee(db, actor.collegeId, scope, input.assignee);
      await this.checkMetric(db, actor.collegeId, input.metricId ?? null, input.documentKey ?? null);
      const year = await this.currentYear(db, actor.collegeId);
      const task = await db.task.create({
        data: {
          collegeId: actor.collegeId,
          academicYearId: year.id,
          title: input.title,
          description: input.description ?? null,
          metricId: input.metricId ?? null,
          documentKey: input.metricId ? (input.documentKey ?? null) : null,
          assigneeUserId: input.assignee.kind === 'user' ? input.assignee.id : null,
          assigneeDepartmentId: input.assignee.kind === 'department' ? input.assignee.id : null,
          createdById: actor.id,
          dueDate: fromIsoDate(input.dueDate),
          repeatRule: input.repeat === 'none' ? undefined : { every: input.repeat },
          reminderRule: { preset: input.reminders, ...REMINDER_RULES[input.reminders] },
        },
      });
      await audit(db, actor, 'task', task.id, 'create', { after: input });
      const creator = await db.user.findFirstOrThrow({ where: { id: actor.id }, select: { name: true } });
      await this.notifications.notify(db, {
        collegeId: actor.collegeId,
        userIds: (await this.assigneeUserIds(db, actor.collegeId, task)).filter((u) => u !== actor.id),
        kind: 'task_assigned',
        text: `${creator.name} assigned you: ${input.title} (due ${formatDay(input.dueDate)})`,
        link: `/tasks?task=${task.id}`,
        dedupeKey: `task:${task.id}:assigned`,
      });
      return task.id;
    });
    return this.get(actor, id);
  }

  async update(actor: AuthUser, id: string, input: TaskValues): Promise<TaskView> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    const scope = this.assignScope(grants);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const before = await this.editable(db, actor, grants, id);
      await this.checkAssignee(db, actor.collegeId, scope, input.assignee);
      await this.checkMetric(db, actor.collegeId, input.metricId ?? null, input.documentKey ?? null);
      await db.task.update({
        where: { id },
        data: {
          title: input.title,
          description: input.description ?? null,
          metricId: input.metricId ?? null,
          documentKey: input.metricId ? (input.documentKey ?? null) : null,
          assigneeUserId: input.assignee.kind === 'user' ? input.assignee.id : null,
          assigneeDepartmentId: input.assignee.kind === 'department' ? input.assignee.id : null,
          dueDate: fromIsoDate(input.dueDate),
          repeatRule: input.repeat === 'none' ? { every: 'none' } : { every: input.repeat },
          reminderRule: { preset: input.reminders, ...REMINDER_RULES[input.reminders] },
        },
      });
      await audit(db, actor, 'task', id, 'update', { before: { title: before.title, dueDate: before.dueDate }, after: input });
    });
    return this.get(actor, id);
  }

  /** Closes a task by hand (e.g. done outside YuCampus), or opens it again. */
  async setDone(actor: AuthUser, id: string, done: boolean): Promise<TaskView> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      await this.editable(db, actor, grants, id);
      await db.task.update({ where: { id }, data: done ? { status: 'done', completedAt: new Date() } : { status: 'open', completedAt: null } });
      await audit(db, actor, 'task', id, done ? 'mark_done' : 'reopen');
    });
    return this.get(actor, id);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const before = await this.editable(db, actor, grants, id);
      // Evidence uploaded for it stays; it just no longer points at a task.
      await db.evidence.updateMany({ where: { collegeId: actor.collegeId, taskId: id }, data: { taskId: null } });
      await db.task.delete({ where: { id } });
      await audit(db, actor, 'task', id, 'delete', { before: { title: before.title } });
    });
  }

  /** "Remind everyone now": a reminder today for every overdue task the person manages. */
  async remindOverdue(actor: AuthUser): Promise<{ reminded: number }> {
    const board = await this.board(actor);
    const overdue = board.tasks.filter((task) => task.overdue && task.can.edit);
    const today = indiaNow().date;
    let reminded = 0;
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      for (const task of overdue) {
        const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
        reminded += await this.notifications.notify(db, {
          collegeId: actor.collegeId,
          userIds: await this.assigneeUserIds(db, actor.collegeId, row),
          kind: 'task_overdue',
          text: `Reminder: ${task.title} was due ${formatDay(task.dueDate)}`,
          link: `/tasks?task=${task.id}`,
          dedupeKey: `task:${task.id}:manual:${today}`,
        });
      }
    });
    return { reminded };
  }

  /** One task per required document still missing (finally approved evidence counts as done). */
  async fromGaps(actor: AuthUser, raw: GapTasksInput): Promise<GapTasksResult> {
    const input = gapTasksSchema.parse(raw);
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    const scope = this.assignScope(grants);
    const overview = await this.accreditation.overview(actor, 'NAAC', input.frameworkId);
    if (!overview || overview.framework.id !== input.frameworkId) throw notFound('framework');
    const numbers = input.criterionNumber ? [input.criterionNumber] : overview.criteria.filter((c) => !c.pending).map((c) => c.number);
    const gaps: { metricId: string; code: string; documentKey: string; documentName: string }[] = [];
    for (const number of numbers) {
      const criterion = await this.accreditation.criterion(actor, input.frameworkId, number);
      for (const metric of criterion.metrics) {
        const detail = await this.accreditation.metric(actor, metric.id);
        for (const doc of detail.documents.filter((d) => !d.satisfied)) {
          gaps.push({ metricId: metric.id, code: metric.code, documentKey: doc.key, documentName: doc.name });
        }
      }
    }

    return this.prisma.forTenant(actor.collegeId, async (db) => {
      await this.checkAssignee(db, actor.collegeId, scope, input.assignee);
      const year = await this.currentYear(db, actor.collegeId);
      const open = await db.task.findMany({
        where: { collegeId: actor.collegeId, status: { not: 'done' }, metricId: { in: [...new Set(gaps.map((g) => g.metricId))] } },
        select: { metricId: true, documentKey: true },
      });
      const exists = new Set(open.map((t) => `${t.metricId}:${t.documentKey}`));
      const todo = gaps.filter((g) => !exists.has(`${g.metricId}:${g.documentKey}`));
      const reminder = REMINDER_RULES[input.reminders];
      if (todo.length) {
        await db.task.createMany({
          data: todo.map((gap) => ({
            collegeId: actor.collegeId,
            academicYearId: year.id,
            title: `${gap.code}: ${gap.documentName}`.slice(0, 200),
            metricId: gap.metricId,
            documentKey: gap.documentKey,
            assigneeUserId: input.assignee.kind === 'user' ? input.assignee.id : null,
            assigneeDepartmentId: input.assignee.kind === 'department' ? input.assignee.id : null,
            createdById: actor.id,
            dueDate: fromIsoDate(input.dueDate),
            reminderRule: { preset: input.reminders, ...reminder },
          })),
        });
        const creator = await db.user.findFirstOrThrow({ where: { id: actor.id }, select: { name: true } });
        const fakeTask = {
          assigneeUserId: input.assignee.kind === 'user' ? input.assignee.id : null,
          assigneeDepartmentId: input.assignee.kind === 'department' ? input.assignee.id : null,
        };
        await this.notifications.notify(db, {
          collegeId: actor.collegeId,
          userIds: (await this.assigneeUserIds(db, actor.collegeId, fakeTask)).filter((u) => u !== actor.id),
          kind: 'task_assigned',
          text: `${creator.name} assigned you ${todo.length} task${todo.length === 1 ? '' : 's'} for ${overview.framework.name}${input.criterionNumber ? ` criterion ${input.criterionNumber}` : ''} (due ${formatDay(input.dueDate)})`,
          link: '/tasks',
        });
        await audit(db, actor, 'task', input.frameworkId, 'create_from_gaps', { after: { count: todo.length, criterion: input.criterionNumber ?? 'all' } });
      }
      return { created: todo.length, skipped: gaps.length - todo.length };
    });
  }

  // ---------------------------------------------------------------- Reminders (background job)

  /** Due-date and overdue reminders, repeating tasks and key dates, for every college. Safe to run any number of times. */
  async sweep(now = new Date()): Promise<{ reminders: number; repeated: number }> {
    let reminders = 0;
    let repeated = 0;
    const today = indiaNow(now).date;
    for (const collegeId of await this.prisma.collegeIds()) {
      const result = await this.prisma.forTenant(collegeId, (db) => this.sweepCollege(db, collegeId, today));
      reminders += result.reminders;
      repeated += result.repeated;
    }
    return { reminders, repeated };
  }

  private async sweepCollege(db: TenantClient, collegeId: string, today: string) {
    let reminders = 0;
    let repeated = 0;
    const open = await db.task.findMany({ where: { collegeId, status: { not: 'done' }, dueDate: { not: null } } });
    for (const task of open) {
      const due = toIsoDate(task.dueDate!);
      const rule = REMINDER_RULES[remindersOf(task.reminderRule)];
      const userIds = await this.assigneeUserIds(db, collegeId, task);
      for (const days of rule.daysBefore) {
        if (today >= addDays(due, -days) && today <= due) {
          const left = Math.round((fromIsoDate(due).getTime() - fromIsoDate(today).getTime()) / DAY);
          reminders += await this.notifications.notify(db, {
            collegeId,
            userIds,
            kind: 'task_due',
            text: left === 0 ? `Due today: ${task.title}` : `Due in ${left} day${left === 1 ? '' : 's'}: ${task.title}`,
            link: `/tasks?task=${task.id}`,
            dedupeKey: `task:${task.id}:due:${due}:${days}`,
          });
        }
      }
      if (today > due) {
        reminders += await this.notifications.notify(db, {
          collegeId,
          userIds,
          kind: 'task_overdue',
          text: `Overdue: ${task.title} was due ${formatDay(due)}`,
          link: `/tasks?task=${task.id}`,
          dedupeKey: rule.overdueDaily ? `task:${task.id}:overdue:${today}` : `task:${task.id}:overdue`,
        });
      }
    }

    // A repeating task gets its next occurrence once it is done or its due date has passed.
    const repeating = await db.task.findMany({ where: { collegeId, repeatedAt: null, dueDate: { not: null } } });
    for (const task of repeating) {
      const every = repeatOf(task.repeatRule);
      const due = toIsoDate(task.dueDate!);
      if (every === 'none' || (task.status !== 'done' && today <= due)) continue;
      const nextDate = nextDue(due, every);
      const year = await db.academicYear.findFirst({
        where: { collegeId, status: { in: ['current', 'next'] }, startDate: { lte: fromIsoDate(nextDate) }, endDate: { gte: fromIsoDate(nextDate) } },
      });
      const next = await db.task.create({
        data: {
          collegeId,
          academicYearId: year?.id ?? task.academicYearId,
          title: task.title,
          description: task.description,
          metricId: task.metricId,
          documentKey: task.documentKey,
          assigneeUserId: task.assigneeUserId,
          assigneeDepartmentId: task.assigneeDepartmentId,
          createdById: task.createdById,
          dueDate: fromIsoDate(nextDate),
          repeatRule: task.repeatRule ?? undefined,
          reminderRule: task.reminderRule ?? undefined,
        },
      });
      await db.task.update({ where: { id: task.id }, data: { repeatedAt: new Date() } });
      await this.notifications.notify(db, {
        collegeId,
        userIds: await this.assigneeUserIds(db, collegeId, next),
        kind: 'task_assigned',
        text: `New ${every === 'month' ? 'monthly' : every === 'semester' ? 'semester' : 'yearly'} task: ${next.title} (due ${formatDay(nextDate)})`,
        link: `/tasks?task=${next.id}`,
        dedupeKey: `task:${next.id}:assigned`,
      });
      repeated++;
    }

    // College key dates: remind the people who run accreditation.
    const keyDates = await db.keyDate.findMany({ where: { collegeId, academicYear: { status: 'current' } } });
    if (keyDates.length) {
      const leaders = await db.userRole.findMany({
        where: { collegeId, role: { in: ['iqac', 'college_admin', 'principal'] } },
        select: { userId: true },
      });
      for (const keyDate of keyDates) {
        const date = toIsoDate(keyDate.date);
        const days = ((keyDate.reminderRule as { daysBefore?: number[] } | null)?.daysBefore ?? [7])[0] ?? 7;
        if (today >= addDays(date, -days) && today <= date) {
          reminders += await this.notifications.notify(db, {
            collegeId,
            userIds: leaders.map((l) => l.userId),
            kind: 'key_date',
            text: `${keyDate.title} is on ${formatDay(date)}`,
            link: '/setup/academic-year',
            dedupeKey: `keydate:${keyDate.id}:${date}`,
          });
        }
      }
    }
    return { reminders, repeated };
  }

  // ---------------------------------------------------------------- Rules

  private assignScope(grants: readonly Grant[]): AssignScope | null {
    if (can(grants, 'tasks.assign', ['college'])) return { college: true };
    const departments = departmentsFor(grants, 'tasks.assign');
    return departments.length ? { college: false, departments } : null;
  }

  /** Assignees must be in this college; a department-scoped assigner (HOD) may only pick their departments and people. */
  private async checkAssignee(db: TenantClient, collegeId: string, scope: AssignScope | null, assignee: TaskValues['assignee']) {
    if (!scope) throw apiError(403, 'forbidden', 'You cannot assign tasks. Ask your IQAC coordinator.');
    if (assignee.kind === 'department') {
      const department = await db.department.findFirst({ where: { id: assignee.id, collegeId } });
      if (!department) throw notFound('department');
      if (!scope.college && !scope.departments.includes(assignee.id)) {
        throw apiError(403, 'department_only', 'You can give tasks to your own department only.');
      }
    } else {
      const user = await db.user.findFirst({ where: { id: assignee.id, collegeId }, include: { roles: true } });
      if (!user) throw notFound('person');
      if (!scope.college && !user.roles.some((r) => r.departmentId && scope.departments.includes(r.departmentId))) {
        throw apiError(403, 'department_only', 'You can give tasks to people of your own department only.');
      }
    }
  }

  private async checkMetric(db: TenantClient, collegeId: string, metricId: string | null, documentKey: string | null) {
    if (!metricId) return;
    const active = await this.accreditation.activeFrameworkIds(db, collegeId);
    const metric = await db.metric.findFirst({ where: { id: metricId, criterion: { frameworkId: { in: active } } } });
    if (!metric) throw apiError(400, 'invalid_input', 'That metric is not part of a framework your college works against.');
    const docs = (Array.isArray(metric.requiredDocuments) ? metric.requiredDocuments : []) as { key: string }[];
    if (documentKey && !docs.some((d) => d.key === documentKey)) throw apiError(400, 'invalid_input', 'That metric does not need that document.');
  }

  private async currentYear(db: TenantClient, collegeId: string) {
    const year = await db.academicYear.findFirst({ where: { collegeId, status: 'current' } });
    if (!year) throw apiError(409, 'no_current_year', 'Your college has no current academic year. Ask your college admin.');
    return year;
  }

  /** Everyone a task is for: the person, or the faculty and head of the department. */
  async assigneeUserIds(db: TenantClient, collegeId: string, task: { assigneeUserId: string | null; assigneeDepartmentId: string | null }) {
    if (task.assigneeUserId) return [task.assigneeUserId];
    if (!task.assigneeDepartmentId) return [];
    const roles = await db.userRole.findMany({
      where: { collegeId, departmentId: task.assigneeDepartmentId, role: { in: ['faculty', 'hod'] } },
      select: { userId: true },
    });
    return [...new Set(roles.map((r) => r.userId))];
  }

  /**
   * Tasks a person may see: all of them for college-wide assigners and dashboards; otherwise their own, their
   * departments', those they created, and (HOD) those given to their department's people.
   */
  private async visibleWhere(db: TenantClient, actor: AuthUser, grants: readonly Grant[]): Promise<Prisma.TaskWhereInput> {
    if (can(grants, 'tasks.assign', ['college']) || can(grants, 'dashboards.view', ['college'])) return {};
    const myDepartments = [...new Set(actor.roles.map((r) => r.departmentId).filter((d): d is string => Boolean(d)))];
    const managed = departmentsFor(grants, 'tasks.assign');
    const managedPeople = managed.length
      ? (await db.userRole.findMany({ where: { collegeId: actor.collegeId, departmentId: { in: managed } }, select: { userId: true } })).map(
          (r) => r.userId,
        )
      : [];
    return {
      OR: [
        { assigneeUserId: actor.id },
        { createdById: actor.id },
        ...(myDepartments.length ? [{ assigneeDepartmentId: { in: myDepartments } }] : []),
        ...(managedPeople.length ? [{ assigneeUserId: { in: managedPeople } }] : []),
      ],
    };
  }

  private async editable(db: TenantClient, actor: AuthUser, grants: readonly Grant[], id: string) {
    const task = await db.task.findFirst({ where: { id, collegeId: actor.collegeId, AND: [await this.visibleWhere(db, actor, grants)] } });
    if (!task) throw notFound('task');
    if (task.createdById !== actor.id && !can(grants, 'tasks.assign', ['college'])) {
      throw apiError(403, 'forbidden', 'Only the person who gave this task (or IQAC) can change it.');
    }
    return task;
  }

  private async views(db: TenantClient, actor: AuthUser, grants: readonly Grant[], rows: TaskRow[]): Promise<TaskView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [evidence, people, departments] = await Promise.all([
      db.evidence.findMany({
        where: { collegeId: actor.collegeId, taskId: { in: ids } },
        select: { id: true, title: true, status: true, taskId: true },
        orderBy: { createdAt: 'asc' },
      }),
      db.user.findMany({
        where: { collegeId: actor.collegeId, id: { in: [...new Set(rows.flatMap((r) => [r.createdById, r.assigneeUserId ?? '']))].filter(Boolean) } },
        select: { id: true, name: true },
      }),
      db.department.findMany({ where: { collegeId: actor.collegeId }, select: { id: true, code: true, name: true } }),
    ]);
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const departmentOf = new Map(departments.map((d) => [d.id, d]));
    const myDepartments = new Set(actor.roles.filter((r) => r.role === 'faculty' || r.role === 'hod').map((r) => r.departmentId));
    const today = indiaNow().date;
    const canUpload = can(grants, 'evidence.upload');
    const collegeAssigner = can(grants, 'tasks.assign', ['college']);

    return rows.map((row) => {
      const mine = evidence.filter((e) => e.taskId === row.id);
      const due = toIsoDate(row.dueDate ?? row.createdAt);
      let stage: TaskStage = 'to_do';
      if (row.status === 'done' || mine.some((e) => e.status === 'approved')) stage = 'approved';
      else if (mine.some((e) => e.status === 'in_review' || e.status === 'department_approved')) stage = 'submitted';
      else if (mine.some((e) => e.status === 'needs_fix')) stage = 'in_progress';
      const documents = (Array.isArray(row.metric?.requiredDocuments) ? row.metric.requiredDocuments : []) as { key: string; name: string }[];
      const department = row.assigneeDepartmentId ? departmentOf.get(row.assigneeDepartmentId) : undefined;
      const isAssignee = row.assigneeUserId === actor.id || (row.assigneeDepartmentId !== null && myDepartments.has(row.assigneeDepartmentId));
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        metric: row.metric
          ? { id: row.metric.id, code: row.metric.code, name: row.metric.name, body: row.metric.criterion.framework.body }
          : null,
        documentKey: row.documentKey,
        documentName: documents.find((d) => d.key === row.documentKey)?.name ?? null,
        assignee: department
          ? { kind: 'department' as const, id: department.id, name: `All ${department.code} faculty` }
          : { kind: 'user' as const, id: row.assigneeUserId ?? '', name: nameOf.get(row.assigneeUserId ?? '') ?? 'Someone' },
        dueDate: due,
        repeat: repeatOf(row.repeatRule),
        reminders: remindersOf(row.reminderRule),
        stage,
        overdue: stage !== 'approved' && due < today,
        createdBy: nameOf.get(row.createdById) ?? 'Someone',
        evidence: mine.map(({ id, title, status }) => ({ id, title, status })),
        can: { edit: row.createdById === actor.id || collegeAssigner, upload: canUpload && isAssignee && stage !== 'approved' },
      };
    });
  }
}
