// NBA outcomes: the attainment arithmetic, then the workflow (HOD adds a course, the teacher enters COs, mapping and
// totals, the HOD locks it), permissions, locked years and tenancy.

import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { DEFAULT_ATTAINMENT_RULES } from '@yucampus/types';
import { attainmentRulesSchema } from '@yucampus/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { averageOf, coAttainment, levelFor, poAttainment, rulesOf } from '../src/nba/attainment.js';
import { NbaService } from '../src/nba/nba.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';

const rules = DEFAULT_ATTAINMENT_RULES;

describe('Attainment arithmetic (default rules)', () => {
  it('turns the share of students who reached the target into a level', () => {
    expect([75, 70, 69.9, 60, 55, 49].map((p) => levelFor(p, rules))).toEqual([3, 3, 2, 2, 1, 0]);
  });

  it('works out direct, then final attainment, step by step', () => {
    const result = coAttainment(
      [
        { kind: 'internal', attempted: 30, reached: 24 },
        { kind: 'internal', attempted: 30, reached: 20 },
        { kind: 'end_exam', attempted: 60, reached: 39 },
      ],
      2.5,
      rules,
    );
    // Internal 44/60 = 73.3% → level 3; end exam 39/60 = 65% → level 2.
    expect(result).toMatchObject({ internalPercent: 73.3, endExamPercent: 65, internalLevel: 3, endExamLevel: 2 });
    expect(result.direct).toBe(2.4); // 3 × 40% + 2 × 60%
    expect(result.final).toBe(2.42); // 2.4 × 80% + 2.5 × 20%
    expect(result.meetsTarget).toBe(true);
    expect(result.waitingFor).toBeNull();
  });

  it('says what it is waiting for instead of guessing', () => {
    expect(coAttainment([{ kind: 'internal', attempted: 30, reached: 24 }], 2, rules)).toMatchObject({ direct: null, final: null, waitingFor: 'end exam results' });
    expect(coAttainment([{ kind: 'internal', attempted: 30, reached: 24 }, { kind: 'end_exam', attempted: 30, reached: 24 }], null, rules)).toMatchObject({
      direct: 3,
      final: null,
      waitingFor: 'the course exit survey (indirect attainment)',
    });
    expect(coAttainment([], null, rules).waitingFor).toBe('assessment results');
  });

  it('weights PO attainment by mapping strength, and only when every mapped CO has a result', () => {
    expect(poAttainment([{ final: 2.42, mapping: { po1: 3 } }, { final: 1.5, mapping: { po1: 1 } }], 'po1')).toBe(2.19);
    expect(poAttainment([{ final: 2.42, mapping: { po1: 3 } }, { final: null, mapping: { po1: 1 } }], 'po1')).toBeNull();
    expect(poAttainment([{ final: 2.42, mapping: {} }], 'po1')).toBeNull();
    expect(averageOf([2, null, 3])).toBe(2.5);
  });

  it('keeps rules consistent, and falls back to the defaults when stored rules are broken', () => {
    expect(attainmentRulesSchema.safeParse({ ...rules, internalWeight: 50 }).success).toBe(false);
    expect(attainmentRulesSchema.safeParse({ ...rules, levels: { level3: 50, level2: 60, level1: 40 } }).success).toBe(false);
    expect(rulesOf({ directWeight: 90, indirectWeight: 10 }).directWeight).toBe(90);
    expect(rulesOf({ directWeight: 90 })).toEqual(rules);
  });
});

let database: Database;
let prisma: PrismaService;
let nba: NbaService;
let hod: AuthUser;
let faculty: AuthUser;
let coordinator: AuthUser;
let iqac: AuthUser;
let office: AuthUser;
let principal: AuthUser;
let cse: string;
let ece: string;
let year: string;

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof HttpException) return (error.getResponse() as { code: string }).code;
    throw error;
  }
  return 'no_error';
}

async function actor(subdomain: string, email: string): Promise<AuthUser> {
  const collegeId = (await prisma.resolveCollegeId(subdomain))!;
  const user = await prisma.forTenant(collegeId, (db) => db.user.findFirstOrThrow({ where: { collegeId, email }, include: { roles: true } }));
  return { id: user.id, collegeId, roles: user.roles.map(({ role, departmentId }) => ({ role, departmentId })) };
}

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (owner) => {
      await seed(owner);
      const other = await owner.college.create({ data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' } });
      await owner.user.create({
        data: { collegeId: other.id, name: 'Other College Admin', email: 'admin@other-college.example', status: 'active', roles: { create: [{ collegeId: other.id, role: 'iqac' }] } },
      });
    },
  });
  prisma = new PrismaService(database);
  nba = new NbaService(prisma, new PermissionsService(prisma));
  hod = await actor('sample', 'hod.cse@sample-college.example');
  faculty = await actor('sample', 'faculty@sample-college.example');
  coordinator = await actor('sample', 'nba@sample-college.example');
  iqac = await actor('sample', 'iqac@sample-college.example');
  office = await actor('sample', 'office@sample-college.example');
  principal = await actor('sample', 'principal@sample-college.example');
  await prisma.forTenant(hod.collegeId, async (db) => {
    const programs = await db.program.findMany({ where: { collegeId: hod.collegeId }, include: { department: true } });
    cse = programs.find((p) => p.department.code === 'CSE')!.id;
    ece = programs.find((p) => p.department.code === 'ECE')!.id;
    year = (await db.academicYear.findFirstOrThrow({ where: { collegeId: hod.collegeId, status: 'current' } })).id;
  });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Program outcomes', () => {
  it('gives an engineering program NBA’s twelve POs, marked as not yet checked', async () => {
    const view = await nba.programView(hod, cse);
    expect(view.outcomes.filter((o) => o.kind === 'PO').map((o) => o.code)).toEqual(['PO1', 'PO2', 'PO3', 'PO4', 'PO5', 'PO6', 'PO7', 'PO8', 'PO9', 'PO10', 'PO11', 'PO12']);
    expect(view.outcomes.every((o) => !o.editable)).toBe(true);
    expect(view.outcomesSource?.verified).toBe(false);
    expect(view.rules).toEqual(DEFAULT_ATTAINMENT_RULES);
    expect(view.can).toEqual({ manage: true, addCourse: true });
  });

  it('lets the HOD add PSOs, and not a teacher', async () => {
    const view = await nba.setPsos(hod, cse, { psos: [{ code: 'pso1', statement: 'Build software systems for real users' }] });
    expect(view.outcomes.filter((o) => o.kind === 'PSO').map((o) => o.code)).toEqual(['PSO1']);
    expect(await codeOf(nba.setPsos(faculty, cse, { psos: [] }))).toBe('forbidden');
  });
});

describe('Courses', () => {
  let course: string;
  const outcomeIds: string[] = [];

  it('is added by the HOD or NBA coordinator for their programs only', async () => {
    const created = await nba.createCourse(hod, cse, { academicYearId: year, code: 'cs501', name: 'Machine Learning', semester: 5, teacherId: faculty.id });
    expect(created).toMatchObject({ code: 'CS501', status: 'draft', teacher: { id: faculty.id } });
    course = created.id;
    expect(await codeOf(nba.createCourse(hod, ece, { academicYearId: year, code: 'EC501', name: 'VLSI' }))).toBe('forbidden');
    expect(await codeOf(nba.createCourse(faculty, cse, { academicYearId: year, code: 'CS599', name: 'Mine' }))).toBe('forbidden');
    expect(await codeOf(nba.createCourse(coordinator, cse, { academicYearId: year, code: 'CS501', name: 'Again' }))).toBe('course_code_taken');
    expect((await nba.createCourse(coordinator, ece, { academicYearId: year, code: 'EC501', name: 'VLSI Design' })).code).toBe('EC501');
  });

  it('shows a teacher only the programs and courses they teach', async () => {
    expect((await nba.programs(faculty)).map((p) => p.id)).toEqual([cse]);
    const view = await nba.programView(faculty, cse);
    expect(view.courses.map((c) => c.code)).toEqual(['CS501']);
    expect(view.courses[0]!.can).toEqual({ edit: true, lock: false });
    expect(await codeOf(nba.programView(faculty, ece))).toBe('not_found');
    expect(await nba.programs(office)).toEqual([]);
  });

  it('lets the teacher enter COs, the mapping and the totals, and works out attainment', async () => {
    const withOutcomes = await nba.setOutcomes(faculty, course, {
      outcomes: [
        { code: 'co1', statement: 'Explain supervised and unsupervised learning', indirectLevel: 2.5 },
        { code: 'CO2', statement: 'Apply regression and classification to real data', indirectLevel: 2 },
      ],
    });
    outcomeIds.push(...withOutcomes.outcomes.map((o) => o.id));
    const pos = withOutcomes.programOutcomes;
    const po1 = pos.find((p) => p.code === 'PO1')!.id;
    const po2 = pos.find((p) => p.code === 'PO2')!.id;
    await nba.setMapping(faculty, course, {
      cells: [
        { courseOutcomeId: outcomeIds[0]!, programOutcomeId: po1, strength: 3 },
        { courseOutcomeId: outcomeIds[1]!, programOutcomeId: po1, strength: 1 },
        { courseOutcomeId: outcomeIds[1]!, programOutcomeId: po2, strength: 2 },
      ],
    });
    const view = await nba.setResults(faculty, course, {
      results: [
        { courseOutcomeId: outcomeIds[0]!, kind: 'internal', name: 'Internal test 1', attempted: 30, reached: 24 },
        { courseOutcomeId: outcomeIds[0]!, kind: 'internal', name: 'Assignment 1', attempted: 30, reached: 20 },
        { courseOutcomeId: outcomeIds[0]!, kind: 'end_exam', name: 'End exam', attempted: 60, reached: 39 },
        { courseOutcomeId: outcomeIds[1]!, kind: 'internal', name: 'Internal test 1', attempted: 60, reached: 33 },
        { courseOutcomeId: outcomeIds[1]!, kind: 'end_exam', name: 'End exam', attempted: 60, reached: 31 },
      ],
    });
    // CO1 as worked out above: 2.42. CO2: internal 55% → 1, end 51.7% → 1; direct 1; final 1 × 0.8 + 2 × 0.2 = 1.2.
    expect(view.outcomes.map((o) => o.attainment.final)).toEqual([2.42, 1.2]);
    expect(view.outcomes.map((o) => o.attainment.meetsTarget)).toEqual([true, false]);
    expect(view.summary.final).toBe(1.81);
    expect(view.poAttainment.find((p) => p.outcomeId === po1)?.value).toBe(2.12); // (3 × 2.42 + 1 × 1.2) / 4
    expect(view.poAttainment.find((p) => p.outcomeId === po2)?.value).toBe(1.2);
  });

  it('refuses results with more students reaching the target than attempted', async () => {
    expect(await codeOf(nba.setResults(faculty, course, { results: [{ courseOutcomeId: outcomeIds[0]!, kind: 'internal', name: 'Test', attempted: 10, reached: 11 }] }))).not.toBe('no_error');
  });

  it('counts a course for the program only once the HOD locks it; locked courses are read only', async () => {
    expect((await nba.programView(iqac, cse)).poAttainment.every((p) => p.value === null)).toBe(true);
    expect(await codeOf(nba.setLocked(faculty, course, true))).toBe('forbidden');
    const locked = await nba.setLocked(hod, course, true);
    expect(locked).toMatchObject({ status: 'locked', can: { edit: false, unlock: true } });
    expect(await codeOf(nba.setOutcomes(faculty, course, { outcomes: [] }))).toBe('locked');

    const program = await nba.programView(principal, cse);
    const po1 = program.outcomes.find((o) => o.code === 'PO1')!.id;
    expect(program.poAttainment.find((p) => p.outcomeId === po1)).toEqual({ outcomeId: po1, value: 2.12, courses: 1 });
    expect(program.can.manage).toBe(false);
  });

  it('applies changed rules', async () => {
    const view = await nba.setRules(hod, cse, { ...DEFAULT_ATTAINMENT_RULES, directWeight: 100, indirectWeight: 0 });
    expect(view.courses[0]!.attainment).toBe(1.7); // finals 2.4 and 1.0
  });

  it('shows another college nothing', async () => {
    const other = await actor('other', 'admin@other-college.example');
    expect(await nba.programs(other)).toEqual([]);
    expect(await codeOf(nba.course(other, course))).toBe('not_found');
  });
});
