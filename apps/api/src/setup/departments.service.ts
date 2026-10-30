import { Injectable } from '@nestjs/common';
import type { DepartmentView, ProgramView } from '@yucampus/types';
import type { CreateDepartmentInput, ProgramFrameworkInput, ProgramInput, UpdateDepartmentInput } from '@yucampus/validation';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { isUniqueViolation, notFound } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';

const PROGRAM_SELECT = {
  id: true,
  name: true,
  level: true,
  frameworks: { where: { active: true }, select: { framework: { select: { id: true, code: true, name: true } } }, take: 1 },
} satisfies Prisma.ProgramSelect;

const toProgramView = ({ frameworks, ...program }: Prisma.ProgramGetPayload<{ select: typeof PROGRAM_SELECT }>): ProgramView => ({
  ...program,
  framework: frameworks[0]?.framework ?? null,
});

const codeTaken = (code: string) => apiError(409, 'department_code_taken', `Another department already uses the code ${code}.`);

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: AuthUser): Promise<DepartmentView[]> {
    return this.prisma.forTenant(actor.collegeId, (db) => this.load(db, actor.collegeId));
  }

  async create(actor: AuthUser, input: CreateDepartmentInput & { code: string }): Promise<DepartmentView> {
    try {
      const id = await this.prisma.forTenant(actor.collegeId, async (db) => {
        const department = await db.department.create({
          data: {
            collegeId: actor.collegeId,
            name: input.name,
            code: input.code,
            programs: {
              create: (input.programs ?? []).map((program) => ({
                collegeId: actor.collegeId,
                name: program.name,
                level: program.level,
              })),
            },
          },
        });
        await audit(db, actor, 'department', department.id, 'create', { after: input });
        return department.id;
      });
      return this.one(actor, id);
    } catch (error) {
      throw isUniqueViolation(error) ? codeTaken(input.code) : error;
    }
  }

  async update(actor: AuthUser, id: string, input: UpdateDepartmentInput): Promise<DepartmentView> {
    try {
      await this.prisma.forTenant(actor.collegeId, async (db) => {
        const before = await db.department.findFirst({ where: { id, collegeId: actor.collegeId } });
        if (!before) throw notFound('department');
        const previousHod = await db.userRole.findFirst({ where: { collegeId: actor.collegeId, role: 'hod', departmentId: id } });

        if (input.hodUserId !== (previousHod?.userId ?? null)) {
          if (input.hodUserId) {
            // Service-layer tenant check: foreign keys are not limited by row-level security.
            const person = await db.user.findFirst({ where: { id: input.hodUserId, collegeId: actor.collegeId } });
            if (!person) throw notFound('person');
          }
          if (previousHod) await db.userRole.delete({ where: { id: previousHod.id } });
          if (input.hodUserId) {
            await db.userRole.create({
              data: { collegeId: actor.collegeId, userId: input.hodUserId, role: 'hod', departmentId: id },
            });
          }
        }

        await db.department.update({ where: { id }, data: { name: input.name, code: input.code } });
        await audit(db, actor, 'department', id, 'update', {
          before: { name: before.name, code: before.code, hodUserId: previousHod?.userId ?? null },
          after: input,
        });
      });
    } catch (error) {
      throw isUniqueViolation(error) ? codeTaken(input.code) : error;
    }
    return this.one(actor, id);
  }

  /** Only an empty department can be removed: no people, evidence or tasks point at it. */
  async remove(actor: AuthUser, id: string): Promise<void> {
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const where = { collegeId: actor.collegeId };
      const department = await db.department.findFirst({ where: { ...where, id } });
      if (!department) throw notFound('department');
      const [people, evidence, tasks] = await Promise.all([
        db.userRole.count({ where: { ...where, departmentId: id } }),
        db.evidence.count({ where: { ...where, departmentId: id } }),
        db.task.count({ where: { ...where, assigneeDepartmentId: id } }),
      ]);
      if (people + evidence + tasks > 0) {
        throw apiError(
          409,
          'department_in_use',
          `${department.code} still has people, evidence or tasks. Move them to another department first.`,
        );
      }
      await db.department.delete({ where: { id } });
      await audit(db, actor, 'department', id, 'delete', { before: { name: department.name, code: department.code } });
    });
  }

  async addProgram(actor: AuthUser, departmentId: string, input: ProgramInput): Promise<ProgramView> {
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const department = await db.department.findFirst({ where: { id: departmentId, collegeId: actor.collegeId } });
      if (!department) throw notFound('department');
      const program = await db.program.create({
        data: { collegeId: actor.collegeId, departmentId, name: input.name, level: input.level },
        select: PROGRAM_SELECT,
      });
      await audit(db, actor, 'program', program.id, 'create', { after: { departmentId, ...input } });
      return toProgramView(program);
    });
  }

  async updateProgram(actor: AuthUser, id: string, input: ProgramInput): Promise<ProgramView> {
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const before = await db.program.findFirst({ where: { id, collegeId: actor.collegeId } });
      if (!before) throw notFound('program');
      const program = await db.program.update({
        where: { id },
        data: { name: input.name, level: input.level },
        select: PROGRAM_SELECT,
      });
      await audit(db, actor, 'program', id, 'update', {
        before: { name: before.name, level: before.level },
        after: input,
      });
      return toProgramView(program);
    });
  }

  /**
   * Sets the program-level framework (e.g. NBA engineering Tier II) a program is assessed against, or none.
   * The previous one is switched off but kept, so its data stays.
   */
  async setProgramFramework(actor: AuthUser, programId: string, input: ProgramFrameworkInput): Promise<ProgramView> {
    if (input.frameworkId) {
      const framework = await this.prisma.rules.framework.findFirst({
        where: { id: input.frameworkId, attachesTo: 'program', status: { not: 'retired' } },
      });
      if (!framework) throw apiError(400, 'invalid_input', 'That is not a framework a program can be assessed against.');
    }
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const program = await db.program.findFirst({ where: { id: programId, collegeId: actor.collegeId }, select: PROGRAM_SELECT });
      if (!program) throw notFound('program');
      const before = program.frameworks[0]?.framework.id ?? null;
      if (before !== input.frameworkId) {
        await db.programFramework.updateMany({
          where: { collegeId: actor.collegeId, programId, active: true },
          data: { active: false, retiredAt: new Date() },
        });
        if (input.frameworkId) {
          const existing = await db.programFramework.findFirst({ where: { programId, frameworkId: input.frameworkId, cycleId: null } });
          if (existing) {
            await db.programFramework.update({ where: { id: existing.id }, data: { active: true, retiredAt: null } });
          } else {
            await db.programFramework.create({ data: { collegeId: actor.collegeId, programId, frameworkId: input.frameworkId } });
          }
        }
        await audit(db, actor, 'program', programId, 'set_framework', { before: { frameworkId: before }, after: input });
      }
      return toProgramView(await db.program.findUniqueOrThrow({ where: { id: programId }, select: PROGRAM_SELECT }));
    });
  }

  async removeProgram(actor: AuthUser, id: string): Promise<void> {
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const program = await db.program.findFirst({ where: { id, collegeId: actor.collegeId } });
      if (!program) throw notFound('program');
      await db.program.delete({ where: { id } });
      await audit(db, actor, 'program', id, 'delete', { before: { name: program.name, departmentId: program.departmentId } });
    });
  }

  private async one(actor: AuthUser, id: string): Promise<DepartmentView> {
    const [department] = await this.prisma.forTenant(actor.collegeId, (db) => this.load(db, actor.collegeId, id));
    if (!department) throw notFound('department');
    return department;
  }

  private async load(db: TenantClient, collegeId: string, id?: string): Promise<DepartmentView[]> {
    const departments = await db.department.findMany({
      where: { collegeId, ...(id ? { id } : {}) },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        programs: { select: PROGRAM_SELECT, orderBy: { name: 'asc' } },
        userRoles: {
          where: { role: { in: ['hod', 'faculty'] } },
          select: { role: true, user: { select: { id: true, name: true } } },
        },
      },
    });
    return departments.map(({ userRoles, programs, ...department }) => {
      const hod = userRoles.find((assignment) => assignment.role === 'hod')?.user ?? null;
      return {
        ...department,
        programs: programs.map(toProgramView),
        hod,
        facultyCount: userRoles.filter((assignment) => assignment.role === 'faculty').length,
      };
    });
  }
}
