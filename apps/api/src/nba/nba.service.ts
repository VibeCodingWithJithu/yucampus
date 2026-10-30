import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  type AttainmentRules,
  type CourseSummary,
  type CourseView,
  type Grant,
  type ProgramNbaView,
  type ProgramOutcomeView,
  can,
  departmentsFor,
} from '@yucampus/types';
import {
  type AssessmentResultsInput,
  type AttainmentRulesInput,
  type CoPoMappingInput,
  type CourseInput,
  type CourseOutcomesInput,
  type ProgramProfileInput,
  type PsosInput,
  assessmentResultsSchema,
  programProfileSchema,
  courseInputSchema,
  courseOutcomesSchema,
  psosSchema,
} from '@yucampus/validation';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { isUniqueViolation, notFound } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';
import { averageOf, coAttainment, poAttainment, rulesOf } from './attainment.js';

/** NBA's POs for engineering programs (rules file; copied into a program the first time it is opened). */
interface OutcomeFile {
  appliesTo: string[];
  source: { title: string; verified: boolean };
  outcomes: { code: string; statement: string }[];
}
const OUTCOMES: OutcomeFile = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../../rules/nba/program-outcomes.json'), 'utf8'),
) as OutcomeFile;

/**
 * Who may do what (docs/PRODUCT.md, decided 2026-10-17):
 * manage = nba.manage at college (IQAC, NBA coordinator) or department (HOD): courses, teachers, rules, PSOs, lock;
 * teach = nba.manage "own" (faculty): the courses they teach, while unlocked;
 * read = anyone who manages, views college/department dashboards, or reports for NBA.
 */
interface Access {
  manage: { college: true } | { college: false; departments: string[] };
  read: { college: true } | { college: false; departments: string[] };
  teach: boolean;
}

function accessFrom(grants: readonly Grant[]): Access {
  const manageCollege = can(grants, 'nba.manage', ['college']);
  const manageDepartments = departmentsFor(grants, 'nba.manage');
  const readCollege = manageCollege || can(grants, 'dashboards.view', ['college']) || can(grants, 'reports.generate', ['nba']);
  return {
    manage: manageCollege ? { college: true } : { college: false, departments: manageDepartments },
    read: readCollege ? { college: true } : { college: false, departments: [...new Set([...manageDepartments, ...departmentsFor(grants, 'dashboards.view')])] },
    teach: can(grants, 'nba.manage', ['own']),
  };
}

/** A program's stored vision, mission and PEOs; anything unreadable shows as empty. */
export function profileOf(raw: unknown) {
  const parsed = programProfileSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { vision: '', mission: '', peos: [] };
}

const manages = (access: Access, departmentId: string) => access.manage.college || access.manage.departments.includes(departmentId);
const reads = (access: Access, departmentId: string) => access.read.college || access.read.departments.includes(departmentId);
/** Checks input with a shared schema; problems become a plain 400, also when the service is called directly. */
function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw apiError(400, 'invalid_input', result.error.issues[0]?.message ?? 'Check the values.');
  return result.data;
}

const readOnly = (what: string) => apiError(409, 'locked', `${what} is locked. Ask the HOD or NBA coordinator to unlock it first.`);

type CourseRow = Prisma.CourseGetPayload<{
  include: { outcomes: { include: { mappings: true; results: true } }; teacher: { select: { id: true; name: true } } };
}>;

@Injectable()
export class NbaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private async access(actor: AuthUser) {
    return accessFrom(await this.permissions.grantsFor(actor.collegeId, actor.roles));
  }

  // ---------------------------------------------------------------- Programs

  /** Programs the person can open: all (or their departments'), or, for a teacher, those of the courses they teach. */
  async programs(actor: AuthUser) {
    const access = await this.access(actor);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const taught = access.teach
        ? (await db.course.findMany({ where: { collegeId: actor.collegeId, teacherId: actor.id }, select: { programId: true } })).map((c) => c.programId)
        : [];
      const rows = await db.program.findMany({
        where: {
          collegeId: actor.collegeId,
          OR: [
            ...(access.read.college ? [{}] : access.read.departments.length ? [{ departmentId: { in: access.read.departments } }] : []),
            ...(taught.length ? [{ id: { in: taught } }] : []),
          ],
        },
        include: {
          department: { select: { code: true } },
          frameworks: { where: { active: true, framework: { body: 'NBA' } }, include: { framework: { select: { name: true } } } },
        },
        orderBy: [{ department: { code: 'asc' } }, { name: 'asc' }],
      });
      // Programs with an NBA format first.
      return rows
        .map((p) => ({ id: p.id, name: p.name, departmentCode: p.department.code, nbaFormat: p.frameworks[0]?.framework.name.replace(/^NBA · /, '') ?? null }))
        .sort((a, b) => Number(Boolean(b.nbaFormat)) - Number(Boolean(a.nbaFormat)));
    });
  }

  private async program(db: TenantClient, collegeId: string, programId: string) {
    const program = await db.program.findFirst({
      where: { id: programId, collegeId },
      include: {
        department: { select: { code: true } },
        frameworks: { where: { active: true, framework: { body: 'NBA' } }, include: { framework: { select: { code: true, name: true } } } },
      },
    });
    if (!program) throw notFound('program');
    return program;
  }

  /** NBA's POs are copied into an engineering program the first time anyone opens it. */
  private async ensureOutcomes(db: TenantClient, collegeId: string, program: Awaited<ReturnType<NbaService['program']>>) {
    const code = program.frameworks[0]?.framework.code;
    if (!code || !OUTCOMES.appliesTo.includes(code)) return null;
    await db.programOutcome.createMany({
      data: OUTCOMES.outcomes.map((o, index) => ({ collegeId, programId: program.id, kind: 'PO', code: o.code, statement: o.statement, sortOrder: index })),
      skipDuplicates: true,
    });
    return OUTCOMES.source;
  }

  private async outcomes(db: TenantClient, programId: string): Promise<ProgramOutcomeView[]> {
    const rows = await db.programOutcome.findMany({ where: { programId }, orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] });
    return rows.map((o) => ({ id: o.id, kind: o.kind as 'PO' | 'PSO', code: o.code, statement: o.statement, editable: o.kind === 'PSO' }));
  }

  private async year(db: TenantClient, collegeId: string, yearId?: string) {
    const year = yearId
      ? await db.academicYear.findFirst({ where: { id: yearId, collegeId } })
      : await db.academicYear.findFirst({ where: { collegeId, status: 'current' } });
    if (!year) throw yearId ? notFound('academic year') : apiError(409, 'no_current_year', 'Your college has no current academic year.');
    return year;
  }

  async programView(actor: AuthUser, programId: string, yearId?: string): Promise<ProgramNbaView> {
    const access = await this.access(actor);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const program = await this.program(db, actor.collegeId, programId);
      const teaches = access.teach && (await db.course.count({ where: { collegeId: actor.collegeId, programId, teacherId: actor.id } })) > 0;
      if (!reads(access, program.departmentId) && !teaches) throw notFound('program');
      const source = await this.ensureOutcomes(db, actor.collegeId, program);
      const year = await this.year(db, actor.collegeId, yearId);
      const rules = rulesOf(program.nbaSettings);
      const outcomes = await this.outcomes(db, programId);
      const canManage = manages(access, program.departmentId);
      const courses = await this.courses(db, actor.collegeId, {
        programId,
        academicYearId: year.id,
        ...(reads(access, program.departmentId) ? {} : { teacherId: actor.id }),
      });
      const views = courses.map((c) => this.summary(c, rules, access, actor, canManage, year.status === 'locked'));
      const locked = courses.filter((c) => c.status === 'locked');
      return {
        program: { id: program.id, name: program.name, departmentCode: program.department.code, nbaFormat: program.frameworks[0]?.framework.name.replace(/^NBA · /, '') ?? null },
        academicYear: { id: year.id, label: year.label, locked: year.status === 'locked' },
        rules,
        profile: profileOf(program.nbaProfile),
        outcomes,
        outcomesSource: source,
        courses: views,
        poAttainment: outcomes.map((o) => {
          const values = locked.map((c) => poAttainment(this.finals(c, rules), o.id));
          return { outcomeId: o.id, value: averageOf(values), courses: values.filter((v) => v !== null).length };
        }),
        can: { manage: canManage, addCourse: canManage && year.status !== 'locked' },
      };
    });
  }

  private courses(db: TenantClient, collegeId: string, where: Prisma.CourseWhereInput) {
    return db.course.findMany({
      where: { collegeId, ...where },
      include: { outcomes: { include: { mappings: true, results: true }, orderBy: { sortOrder: 'asc' } }, teacher: { select: { id: true, name: true } } },
      orderBy: [{ semester: 'asc' }, { code: 'asc' }],
    });
  }

  private finals(course: CourseRow, rules: AttainmentRules) {
    return course.outcomes.map((o) => ({
      final: coAttainment(o.results, o.indirectLevel, rules).final,
      mapping: Object.fromEntries(o.mappings.map((m) => [m.programOutcomeId, m.strength])),
    }));
  }

  private summary(course: CourseRow, rules: AttainmentRules, access: Access, actor: AuthUser, canManage: boolean, yearLocked: boolean): CourseSummary {
    const finals = course.outcomes.map((o) => coAttainment(o.results, o.indirectLevel, rules).final);
    return {
      id: course.id,
      code: course.code,
      name: course.name,
      semester: course.semester,
      teacher: course.teacher,
      status: course.status,
      outcomes: course.outcomes.length,
      attainment: finals.length && finals.every((f) => f !== null) ? averageOf(finals) : null,
      can: {
        edit: !yearLocked && course.status === 'draft' && (canManage || (access.teach && course.teacherId === actor.id)),
        lock: !yearLocked && canManage,
      },
    };
  }

  async setRules(actor: AuthUser, programId: string, rules: AttainmentRulesInput) {
    const access = await this.access(actor);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const program = await this.program(db, actor.collegeId, programId);
      if (!manages(access, program.departmentId)) throw apiError(403, 'forbidden', 'Only the HOD or NBA coordinator can change attainment rules.');
      await db.program.update({ where: { id: programId }, data: { nbaSettings: rules as unknown as Prisma.InputJsonObject } });
      await audit(db, actor, 'program', programId, 'set_attainment_rules', { before: program.nbaSettings, after: rules });
    });
    return this.programView(actor, programId);
  }

  async setProfile(actor: AuthUser, programId: string, raw: ProgramProfileInput) {
    const access = await this.access(actor);
    const input = parse(programProfileSchema, raw);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const program = await this.program(db, actor.collegeId, programId);
      if (!manages(access, program.departmentId)) throw apiError(403, 'forbidden', 'Only the HOD or NBA coordinator can change the vision, mission and PEOs.');
      await db.program.update({ where: { id: programId }, data: { nbaProfile: input as unknown as Prisma.InputJsonObject } });
      await audit(db, actor, 'program', programId, 'set_profile', { before: program.nbaProfile, after: input });
    });
    return this.programView(actor, programId);
  }

  async setPsos(actor: AuthUser, programId: string, raw: PsosInput) {
    const access = await this.access(actor);
    const input = parse(psosSchema, raw);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const program = await this.program(db, actor.collegeId, programId);
      if (!manages(access, program.departmentId)) throw apiError(403, 'forbidden', 'Only the HOD or NBA coordinator can change the program outcomes.');
      const existing = await db.programOutcome.findMany({ where: { programId, kind: 'PSO' } });
      const kept = input.psos.filter((p) => p.id).map((p) => p.id!);
      await db.programOutcome.deleteMany({ where: { programId, kind: 'PSO', id: { notIn: kept } } });
      for (const [index, pso] of input.psos.entries()) {
        const data = { code: pso.code, statement: pso.statement, sortOrder: index };
        if (pso.id && existing.some((e) => e.id === pso.id)) await db.programOutcome.update({ where: { id: pso.id }, data });
        else await db.programOutcome.create({ data: { ...data, collegeId: actor.collegeId, programId, kind: 'PSO' } });
      }
      await audit(db, actor, 'program', programId, 'set_psos', { after: input.psos.map((p) => p.code) });
    });
    return this.programView(actor, programId);
  }

  // ---------------------------------------------------------------- Courses

  private async teacherCheck(db: TenantClient, collegeId: string, teacherId: string | null | undefined) {
    if (teacherId && !(await db.user.findFirst({ where: { id: teacherId, collegeId } }))) throw notFound('teacher');
  }

  async createCourse(actor: AuthUser, programId: string, raw: CourseInput) {
    const access = await this.access(actor);
    const input = parse(courseInputSchema, raw);
    const id = await this.prisma.forTenant(actor.collegeId, async (db) => {
      const program = await this.program(db, actor.collegeId, programId);
      if (!manages(access, program.departmentId)) throw apiError(403, 'forbidden', 'Only the HOD or NBA coordinator can add courses.');
      const year = await this.year(db, actor.collegeId, input.academicYearId);
      if (year.status === 'locked') throw readOnly(year.label);
      await this.teacherCheck(db, actor.collegeId, input.teacherId);
      try {
        const course = await db.course.create({
          data: {
            collegeId: actor.collegeId,
            programId,
            academicYearId: year.id,
            code: input.code,
            name: input.name,
            semester: input.semester ?? null,
            teacherId: input.teacherId ?? null,
          },
        });
        await audit(db, actor, 'course', course.id, 'create', { after: input });
        return course.id;
      } catch (error) {
        if (isUniqueViolation(error)) throw apiError(409, 'course_code_taken', `${input.code} is already a course of this program in ${year.label}.`);
        throw error;
      }
    });
    return this.course(actor, id);
  }

  private async courseRow(db: TenantClient, actor: AuthUser, access: Access, id: string) {
    const course = await db.course.findFirst({
      where: { id, collegeId: actor.collegeId },
      include: {
        outcomes: { include: { mappings: true, results: true }, orderBy: { sortOrder: 'asc' } },
        teacher: { select: { id: true, name: true } },
        program: true,
        academicYear: true,
      },
    });
    if (!course) throw notFound('course');
    const isTeacher = access.teach && course.teacherId === actor.id;
    if (!reads(access, course.program.departmentId) && !isTeacher) throw notFound('course');
    const canManage = manages(access, course.program.departmentId);
    const open = course.status === 'draft' && course.academicYear.status !== 'locked';
    return { course, canManage, canEdit: open && (canManage || isTeacher) };
  }

  async course(actor: AuthUser, id: string): Promise<CourseView> {
    const access = await this.access(actor);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const { course, canManage, canEdit } = await this.courseRow(db, actor, access, id);
      const rules = rulesOf(course.program.nbaSettings);
      const programOutcomes = await this.outcomes(db, course.programId);
      const locker = course.lockedById ? await db.user.findFirst({ where: { id: course.lockedById, collegeId: actor.collegeId }, select: { name: true } }) : null;
      const outcomes = course.outcomes.map((o) => ({
        id: o.id,
        code: o.code,
        statement: o.statement,
        indirectLevel: o.indirectLevel,
        mapping: Object.fromEntries(o.mappings.map((m) => [m.programOutcomeId, m.strength])),
        results: o.results.map((r) => ({ id: r.id, kind: r.kind as 'internal' | 'end_exam', name: r.name, attempted: r.attempted, reached: r.reached })),
        attainment: coAttainment(o.results, o.indirectLevel, rules),
      }));
      const yearOpen = course.academicYear.status !== 'locked';
      return {
        id: course.id,
        code: course.code,
        name: course.name,
        semester: course.semester,
        status: course.status,
        lockedBy: locker?.name ?? null,
        lockedAt: course.lockedAt?.toISOString() ?? null,
        teacher: course.teacher,
        program: { id: course.program.id, name: course.program.name },
        academicYear: { id: course.academicYear.id, label: course.academicYear.label },
        rules,
        programOutcomes,
        outcomes,
        summary: {
          direct: averageOf(outcomes.map((o) => o.attainment.direct)),
          indirect: averageOf(outcomes.map((o) => o.attainment.indirect)),
          final: outcomes.length && outcomes.every((o) => o.attainment.final !== null) ? averageOf(outcomes.map((o) => o.attainment.final)) : null,
        },
        poAttainment: programOutcomes.map((po) => ({ outcomeId: po.id, value: poAttainment(outcomes.map((o) => ({ final: o.attainment.final, mapping: o.mapping })), po.id) })),
        can: { edit: canEdit, lock: yearOpen && canManage && course.status === 'draft', unlock: yearOpen && canManage && course.status === 'locked' },
      };
    });
  }

  async updateCourse(actor: AuthUser, id: string, raw: CourseInput) {
    const access = await this.access(actor);
    const input = parse(courseInputSchema, raw);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const { course, canManage } = await this.courseRow(db, actor, access, id);
      if (!canManage) throw apiError(403, 'forbidden', 'Only the HOD or NBA coordinator can change a course.');
      if (course.status === 'locked') throw readOnly(course.code);
      await this.teacherCheck(db, actor.collegeId, input.teacherId);
      try {
        await db.course.update({
          where: { id },
          data: { code: input.code, name: input.name, semester: input.semester ?? null, teacherId: input.teacherId ?? null },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw apiError(409, 'course_code_taken', `${input.code} is already a course of this program this year.`);
        throw error;
      }
      await audit(db, actor, 'course', id, 'update', { before: { code: course.code, name: course.name, teacherId: course.teacherId }, after: input });
    });
    return this.course(actor, id);
  }

  async removeCourse(actor: AuthUser, id: string) {
    const access = await this.access(actor);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const { course, canManage } = await this.courseRow(db, actor, access, id);
      if (!canManage) throw apiError(403, 'forbidden', 'Only the HOD or NBA coordinator can delete a course.');
      if (course.status === 'locked') throw readOnly(course.code);
      await db.course.delete({ where: { id } });
      await audit(db, actor, 'course', id, 'delete', { before: { code: course.code, name: course.name } });
    });
  }

  private async editable(db: TenantClient, actor: AuthUser, id: string) {
    const access = await this.access(actor);
    const row = await this.courseRow(db, actor, access, id);
    if (!row.canEdit) {
      if (row.course.status === 'locked' || row.course.academicYear.status === 'locked') throw readOnly(row.course.code);
      throw apiError(403, 'forbidden', 'Only the course teacher, the HOD or the NBA coordinator can change this course.');
    }
    return row.course;
  }

  /** Replaces the course's COs. A removed CO takes its mapping and results with it. */
  async setOutcomes(actor: AuthUser, id: string, raw: CourseOutcomesInput) {
    const input = parse(courseOutcomesSchema, raw);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const course = await this.editable(db, actor, id);
      const kept = input.outcomes.filter((o) => o.id && course.outcomes.some((e) => e.id === o.id)).map((o) => o.id!);
      await db.courseOutcome.deleteMany({ where: { courseId: id, id: { notIn: kept } } });
      // Codes are unique per course: move kept ones aside first so CO numbers can be swapped.
      for (const outcomeId of kept) await db.courseOutcome.update({ where: { id: outcomeId }, data: { code: `tmp-${outcomeId}` } });
      for (const [index, o] of input.outcomes.entries()) {
        const data = { code: o.code, statement: o.statement, sortOrder: index, indirectLevel: o.indirectLevel ?? null };
        if (o.id && kept.includes(o.id)) await db.courseOutcome.update({ where: { id: o.id }, data });
        else await db.courseOutcome.create({ data: { ...data, collegeId: actor.collegeId, courseId: id } });
      }
      await audit(db, actor, 'course', id, 'set_outcomes', { after: input.outcomes.map((o) => `${o.code}: ${o.statement}`) });
    });
    return this.course(actor, id);
  }

  async setMapping(actor: AuthUser, id: string, input: CoPoMappingInput) {
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const course = await this.editable(db, actor, id);
      const outcomeIds = new Set(course.outcomes.map((o) => o.id));
      const programOutcomeIds = new Set((await db.programOutcome.findMany({ where: { programId: course.programId }, select: { id: true } })).map((o) => o.id));
      if (input.cells.some((c) => !outcomeIds.has(c.courseOutcomeId) || !programOutcomeIds.has(c.programOutcomeId))) {
        throw apiError(400, 'invalid_input', 'The mapping names an outcome that is not part of this course or program.');
      }
      await db.coPoMapping.deleteMany({ where: { courseOutcomeId: { in: [...outcomeIds] } } });
      await db.coPoMapping.createMany({
        data: input.cells
          .filter((c) => c.strength > 0)
          .map((c) => ({ collegeId: actor.collegeId, courseOutcomeId: c.courseOutcomeId, programOutcomeId: c.programOutcomeId, strength: c.strength })),
      });
      await audit(db, actor, 'course', id, 'set_mapping', { after: { cells: input.cells.filter((c) => c.strength > 0).length } });
    });
    return this.course(actor, id);
  }

  async setResults(actor: AuthUser, id: string, raw: AssessmentResultsInput) {
    const input = parse(assessmentResultsSchema, raw);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const course = await this.editable(db, actor, id);
      const outcomeIds = new Set(course.outcomes.map((o) => o.id));
      if (input.results.some((r) => !outcomeIds.has(r.courseOutcomeId))) throw apiError(400, 'invalid_input', 'A result names a CO that is not part of this course.');
      await db.assessmentResult.deleteMany({ where: { courseId: id } });
      await db.assessmentResult.createMany({ data: input.results.map((r) => ({ ...r, collegeId: actor.collegeId, courseId: id })) });
      await audit(db, actor, 'course', id, 'set_results', { after: { rows: input.results.length } });
    });
    return this.course(actor, id);
  }

  /** Locking makes a course read only and counts it for the program's PO attainment. */
  async setLocked(actor: AuthUser, id: string, locked: boolean) {
    const access = await this.access(actor);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const { course, canManage } = await this.courseRow(db, actor, access, id);
      if (!canManage) throw apiError(403, 'forbidden', 'Only the HOD or NBA coordinator can lock or unlock a course.');
      if (course.academicYear.status === 'locked') throw readOnly(course.academicYear.label);
      if (locked && course.outcomes.length === 0) throw apiError(409, 'no_outcomes', 'Add the course outcomes before locking the course.');
      await db.course.update({
        where: { id },
        data: locked ? { status: 'locked', lockedById: actor.id, lockedAt: new Date() } : { status: 'draft', lockedById: null, lockedAt: null },
      });
      await audit(db, actor, 'course', id, locked ? 'lock' : 'unlock');
    });
    return this.course(actor, id);
  }
}
