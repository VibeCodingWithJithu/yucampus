import { Injectable } from '@nestjs/common';
import {
  CAN_GRANT_COLLEGE_ADMIN,
  type Page,
  type RoleAssignment,
  type UserCounts,
  type UserImportProblem,
  type UserImportResult,
  type UserView,
  can,
  departmentsFor,
  hasAnyRole,
} from '@yucampus/types';
import {
  type UserInputParsed,
  type UserListQuery,
  userImportRowSchema,
} from '@yucampus/validation';
import { PasswordLinksService } from '../auth/password-links.service.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { isUniqueViolation, notFound } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';

/** Whom the actor may manage: the whole college, or only faculty of some departments (HOD). */
type ManageScope = { college: true } | { college: false; departments: string[] };

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  mobile: true,
  status: true,
  lastLoginAt: true,
  roles: {
    select: { role: true, departmentId: true, department: { select: { code: true } } },
    orderBy: { role: 'asc' },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

const toView = ({ roles, lastLoginAt, ...user }: UserRow): UserView => ({
  ...user,
  lastLoginAt: lastLoginAt?.toISOString() ?? null,
  roles: roles.map(({ role, departmentId, department }) => ({ role, departmentId, departmentCode: department?.code ?? null })),
});

const departmentOnly = () =>
  apiError(403, 'department_only', 'You can add and change faculty of your own department only.');

const adminOnly = () =>
  apiError(403, 'admin_only', 'Only a college admin can give, remove or edit the college admin role.');

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly links: PasswordLinksService,
  ) {}

  /** Users and setup permission of the actor: college-wide, or only their departments' faculty. */
  private async scopeOf(actor: AuthUser): Promise<ManageScope> {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    if (can(grants, 'users_setup.manage', ['college'])) return { college: true };
    const departments = departmentsFor(grants, 'users_setup.manage');
    if (departments.length === 0) throw apiError(403, 'forbidden', 'You do not have access to this. Ask your college admin if you need it.');
    return { college: false, departments };
  }

  /** Limits a user query to the people the actor may see. */
  private visible(scope: ManageScope): Prisma.UserWhereInput {
    return scope.college ? {} : { roles: { some: { departmentId: { in: scope.departments } } } };
  }

  /** A department-scoped manager may only give the faculty role, in their own departments. */
  private checkScope(scope: ManageScope, roles: readonly RoleAssignment[]) {
    if (scope.college) return;
    if (!roles.every((r) => r.role === 'faculty' && r.departmentId && scope.departments.includes(r.departmentId))) throw departmentOnly();
  }

  async list(actor: AuthUser, query: UserListQuery): Promise<Page<UserView> & { counts: UserCounts }> {
    const collegeId = actor.collegeId;
    const scope = await this.scopeOf(actor);
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      collegeId,
      AND: [this.visible(scope)],
      ...(query.status ? { status: query.status } : {}),
      ...(query.role || query.departmentId
        ? { roles: { some: { ...(query.role ? { role: query.role } : {}), ...(query.departmentId ? { departmentId: query.departmentId } : {}) } } }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { mobile: { contains: search.replace(/\D/g, '') || search } },
            ],
          }
        : {}),
    };

    return this.prisma.forTenant(collegeId, async (db) => {
      const [rows, total, byStatus] = await Promise.all([
        db.user.findMany({
          where,
          select: USER_SELECT,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.user.count({ where }),
        db.user.groupBy({ by: ['status'], where: { collegeId, ...this.visible(scope) }, _count: { _all: true } }),
      ]);
      const counts: UserCounts = { total: 0, active: 0, invited: 0, not_joined: 0 };
      for (const group of byStatus) {
        counts[group.status] = group._count._all;
        counts.total += group._count._all;
      }
      return { items: rows.map(toView), page: query.page, pageSize: query.pageSize, total, counts };
    });
  }

  async get(actor: AuthUser, id: string): Promise<UserView> {
    const scope = await this.scopeOf(actor);
    const user = await this.prisma.forTenant(actor.collegeId, (db) =>
      db.user.findFirst({ where: { id, collegeId: actor.collegeId, ...this.visible(scope) }, select: USER_SELECT }),
    );
    if (!user) throw notFound('person');
    return toView(user);
  }

  /** Adds a person as "invited". They become active the first time they sign in. */
  async create(actor: AuthUser, input: UserInputParsed): Promise<UserView> {
    this.checkScope(await this.scopeOf(actor), input.roles);
    try {
      const id = await this.prisma.forTenant(actor.collegeId, async (db) => {
        await this.checkRoles(db, actor, input.roles, null);
        const user = await db.user.create({
          data: {
            collegeId: actor.collegeId,
            name: input.name,
            email: input.email ?? null,
            mobile: input.mobile ?? null,
            status: 'invited',
            roles: {
              create: input.roles.map((assignment) => ({ collegeId: actor.collegeId, ...assignment })),
            },
          },
        });
        await audit(db, actor, 'user', user.id, 'invite', { after: input });
        return user.id;
      });
      // After saving, so nobody is emailed about a person who was not added.
      await this.links.invite(actor.collegeId, [id]);
      return this.get(actor, id);
    } catch (error) {
      throw this.mapConflict(error);
    }
  }

  async update(actor: AuthUser, id: string, input: UserInputParsed): Promise<UserView> {
    const scope = await this.scopeOf(actor);
    this.checkScope(scope, input.roles);
    try {
      await this.prisma.forTenant(actor.collegeId, async (db) => {
        const before = await db.user.findFirst({ where: { id, collegeId: actor.collegeId, ...this.visible(scope) }, select: USER_SELECT });
        if (!before) throw notFound('person');
        // A HOD may change only people who are nothing more than faculty in their departments.
        this.checkScope(scope, before.roles);

        const wasAdmin = before.roles.some((assignment) => assignment.role === 'college_admin');
        const staysAdmin = input.roles.some((assignment) => assignment.role === 'college_admin');
        // Editing an admin's details (e.g. their email) could hand over their account, so that is admin-only too.
        if (wasAdmin && !this.canGrantAdmin(actor)) throw adminOnly();
        if (id === actor.id && wasAdmin && !staysAdmin) {
          throw apiError(409, 'cannot_remove_own_admin', 'You cannot remove your own college admin role. Ask another admin.');
        }
        await this.checkRoles(db, actor, input.roles, id);

        await db.userRole.deleteMany({ where: { userId: id, collegeId: actor.collegeId } });
        await db.user.update({
          where: { id },
          data: {
            name: input.name,
            email: input.email ?? null,
            mobile: input.mobile ?? null,
            roles: { create: input.roles.map((assignment) => ({ collegeId: actor.collegeId, ...assignment })) },
          },
        });
        await audit(db, actor, 'user', id, 'update', { before: toView(before), after: input });
      });
    } catch (error) {
      throw this.mapConflict(error);
    }
    return this.get(actor, id);
  }

  /**
   * Adds people from spreadsheet rows. All or nothing: if any row has a problem, nothing is saved.
   * Rows for a person who is already in the college (same email or mobile) are skipped, not changed.
   * Several rows for the same new person (same email or mobile) give that person several roles.
   */
  async import(actor: AuthUser, rows: unknown[], dryRun: boolean): Promise<UserImportResult> {
    const collegeId = actor.collegeId;
    const scope = await this.scopeOf(actor);
    const added: string[] = [];
    const outcome = await this.prisma.forTenant(collegeId, async (db) => {
      const problems: UserImportProblem[] = [];
      const [departments, existing, hods] = await Promise.all([
        db.department.findMany({ where: { collegeId }, select: { id: true, code: true } }),
        db.user.findMany({ where: { collegeId }, select: { email: true, mobile: true } }),
        db.userRole.findMany({ where: { collegeId, role: 'hod' }, select: { departmentId: true } }),
      ]);
      const departmentByCode = new Map(departments.map((department) => [department.code, department.id]));
      const known = new Set(existing.flatMap((user) => [user.email, user.mobile]).filter(Boolean));
      const takenHod = new Set(hods.map((hod) => hod.departmentId));

      const people = new Map<string, { row: number; name: string; email: string | null; mobile: string | null; roles: RoleAssignment[] }>();
      let skipped = 0;

      rows.forEach((raw, index) => {
        const row = index + 2; // Row 1 is the heading.
        const parsed = userImportRowSchema.safeParse(raw);
        if (!parsed.success) {
          problems.push({ row, message: parsed.error.issues[0]?.message ?? 'Check this row' });
          return;
        }
        const { name, email, mobile, role, departmentCode } = parsed.data;
        if ((email && known.has(email)) || (mobile && known.has(mobile))) {
          skipped++;
          return;
        }
        let departmentId: string | null = null;
        if (departmentCode) {
          departmentId = departmentByCode.get(departmentCode) ?? null;
          if (!departmentId) {
            problems.push({ row, message: `There is no department with the code ${departmentCode}. Add it in Institution setup first.` });
            return;
          }
        }
        if (!scope.college && !(role === 'faculty' && departmentId && scope.departments.includes(departmentId))) {
          problems.push({ row, message: 'You can add faculty of your own department only.' });
          return;
        }
        if (role === 'college_admin' && !this.canGrantAdmin(actor)) {
          problems.push({ row, message: 'Only a college admin can add another college admin.' });
          return;
        }
        if (role === 'hod' && departmentId) {
          if (takenHod.has(departmentId)) {
            problems.push({ row, message: `${departmentCode} already has a head of department.` });
            return;
          }
          takenHod.add(departmentId);
        }

        const key = (email ?? mobile)!;
        const other = email && mobile ? (people.get(email) ?? people.get(mobile)) : people.get(key);
        const assignment = { role, departmentId };
        if (other) {
          if (other.name.toLowerCase() !== name.toLowerCase()) {
            problems.push({ row, message: `Row ${other.row} has the same email or mobile for a different name.` });
            return;
          }
          if (!other.roles.some((r) => r.role === assignment.role && r.departmentId === assignment.departmentId)) {
            other.roles.push(assignment);
          }
          return;
        }
        const person = { row, name, email, mobile, roles: [assignment] };
        if (email) people.set(email, person);
        if (mobile) people.set(mobile, person);
      });

      const toCreate = [...new Set(people.values())];
      const result: UserImportResult = { created: toCreate.length, skipped, problems, saved: false };
      if (dryRun || problems.length > 0) return result;

      for (const person of toCreate) {
        const user = await db.user.create({
          data: {
            collegeId,
            name: person.name,
            email: person.email,
            mobile: person.mobile,
            status: 'invited',
            roles: { create: person.roles.map((assignment) => ({ collegeId, ...assignment })) },
          },
        });
        await audit(db, actor, 'user', user.id, 'import', { after: person });
        added.push(user.id);
      }
      return { ...result, saved: true };
    });
    await this.links.invite(collegeId, added);
    return outcome;
  }

  /** Emails the invite again (a new link; the old one stops working). Only for people who have not signed in yet. */
  async resendInvite(actor: AuthUser, id: string): Promise<{ sent: true }> {
    const person = await this.get(actor, id);
    if (person.status === 'active') throw apiError(409, 'already_active', 'This person has already signed in.');
    if (!person.email) throw apiError(422, 'no_email', 'Add an email address first. People without one sign in with a mobile code.');
    await this.links.invite(actor.collegeId, [id]);
    return { sent: true };
  }

  private canGrantAdmin(actor: AuthUser): boolean {
    return hasAnyRole(
      actor.roles.map((assignment) => assignment.role),
      CAN_GRANT_COLLEGE_ADMIN,
    );
  }

  /** Checks a role list against this college before it is saved. */
  private async checkRoles(db: TenantClient, actor: AuthUser, roles: RoleAssignment[], userId: string | null) {
    if (roles.some((assignment) => assignment.role === 'college_admin') && !this.canGrantAdmin(actor)) {
      throw adminOnly();
    }

    // Service-layer tenant check: foreign keys are not limited by row-level security, so a department id
    // from another college would otherwise be accepted.
    const departmentIds = [...new Set(roles.map((assignment) => assignment.departmentId).filter((id) => id !== null))];
    if (departmentIds.length) {
      const found = await db.department.findMany({
        where: { collegeId: actor.collegeId, id: { in: departmentIds } },
        select: { id: true },
      });
      if (found.length !== departmentIds.length) throw notFound('department');
    }

    for (const { departmentId } of roles.filter((assignment) => assignment.role === 'hod')) {
      const current = await db.userRole.findFirst({
        where: { collegeId: actor.collegeId, role: 'hod', departmentId, ...(userId ? { userId: { not: userId } } : {}) },
        select: { user: { select: { name: true } }, department: { select: { code: true } } },
      });
      if (current) {
        throw apiError(
          409,
          'department_has_hod',
          `${current.department?.code} already has a head of department (${current.user.name}). Change it in Institution setup first.`,
        );
      }
    }
  }

  private mapConflict(error: unknown): unknown {
    if (!isUniqueViolation(error)) return error;
    return apiError(409, 'contact_taken', 'Someone in your college already uses that email or mobile number.');
  }
}
