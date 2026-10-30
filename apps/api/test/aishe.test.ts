// AISHE data forms and the consistency checker: the survey year, blocks from the registers (per programme where AISHE
// asks), "not entered" never 0, record / total / change / profile checks, submitted figures against the registers and
// across portals, the workbook, and who may see and record what.

import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AisheService } from '../src/aishe/aishe.service.js';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { RegistersService } from '../src/registers/registers.service.js';

let database: Database;
let prisma: PrismaService;
let aishe: AisheService;
let registers: RegistersService;
let iqac: AuthUser;
let principal: AuthUser;
let nirfCoordinator: AuthUser;
let office: AuthUser;
let faculty: AuthUser;
let otherAdmin: AuthUser;
let current: string;
let locked: string;
let cseProgram: string;
let cse: string;

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

type View = Awaited<ReturnType<AisheService['view']>>;
const block = (view: View, key: string) => view.blocks.find((b) => b.key === key)!;
const item = (view: View, blockKey: string, key: string) => block(view, blockKey).items.find((i) => i.key === key)!;
const codes = (view: View) => view.checks.findings.map((f) => f.code);

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (owner) => {
      await seed(owner);
      const other = await owner.college.create({ data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' } });
      await owner.user.create({
        data: { collegeId: other.id, name: 'Other College Admin', email: 'admin@other-college.example', status: 'active', roles: { create: [{ collegeId: other.id, role: 'principal' }] } },
      });
    },
  });
  prisma = new PrismaService(database);
  const permissions = new PermissionsService(prisma);
  aishe = new AisheService(prisma, permissions);
  registers = new RegistersService(prisma, permissions);
  iqac = await actor('sample', 'iqac@sample-college.example');
  principal = await actor('sample', 'principal@sample-college.example');
  nirfCoordinator = await actor('sample', 'nirf@sample-college.example');
  office = await actor('sample', 'office@sample-college.example');
  faculty = await actor('sample', 'faculty@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');
  await prisma.forTenant(iqac.collegeId, async (db) => {
    current = (await db.academicYear.findFirstOrThrow({ where: { collegeId: iqac.collegeId, status: 'current' } })).id;
    locked = (await db.academicYear.findFirstOrThrow({ where: { collegeId: iqac.collegeId, status: 'locked' } })).id;
    cse = (await db.department.findFirstOrThrow({ where: { collegeId: iqac.collegeId, code: 'CSE' } })).id;
    cseProgram = (await db.program.findFirstOrThrow({ where: { collegeId: iqac.collegeId, departmentId: cse } })).id;
  });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Before any data', () => {
  it('defaults to the latest locked year, shows every block and says what is missing', async () => {
    const view = await aishe.view(iqac);
    expect(view.year.id).toBe(locked);
    expect(view.previousYear).toBeNull();
    expect(view.blocks.map((b) => b.key)).toEqual(['profile', 'programmes', 'results', 'teaching', 'nonTeaching', 'phd', 'scholarships', 'infrastructure', 'finance']);
    // Name, type and state come from setup; nothing else is entered.
    expect(block(view, 'profile').profile.filter((p) => p.value !== null).map((p) => p.key)).toEqual(['name', 'type', 'state']);
    expect(item(view, 'teaching', 'teachers').values).toEqual([null, null]);
    expect(block(view, 'programmes').perProgram!.rows.length).toBeGreaterThan(0);
    expect(codes(view)).toEqual(['PF-AISHE', 'PF-UNIVERSITY', 'PF-ESTABLISHED']);
    expect(view.checks.errors).toBe(1);
    expect(view.source.verified).toBe(false);
  });
});

describe('From the registers', () => {
  beforeAll(async () => {
    // Last year's figures (a locked year, so written directly, as they would have been entered last year).
    await prisma.forTenant(iqac.collegeId, async (db) => {
      const definition = await db.registerDefinition.findFirstOrThrow({ where: { code: 'COLLEGE_FIGURES' } });
      await db.registerRecord.create({
        data: {
          collegeId: iqac.collegeId,
          definitionId: definition.id,
          academicYearId: locked,
          data: { source: 'Office records', studentsOnRoll: 800, sanctionedTeachingPosts: 80, expenditureExSalaryLakh: 240, studentComputers: 280 },
          createdById: iqac.id,
          updatedById: iqac.id,
        },
      });
    });
    await registers.create(iqac, 'COLLEGE_FIGURES', {
      academicYearId: current,
      data: { source: 'Office records', studentsOnRoll: 1200, sanctionedTeachingPosts: 2, expenditureExSalaryLakh: 250, studentComputers: 300, phdStudentsFullTime: 12 },
    });
    await registers.create(iqac, 'STUDENT_BATCHES', {
      academicYearId: current,
      data: { batch: '2026–30', program: cseProgram, intake: 60, enrolled: 66, female: 70, sc: 30, st: 15, obc: 20, ews: 6, appearedFinal: 50, passedOnTime: 52, placed: 30, higherStudies: 5 },
    });
    for (const [name, gender, sanctionedPost] of [
      ['Dr. A', 'Female', true],
      ['Mr. B', 'Male', true],
      ['Ms. C', 'Female', true],
    ] as const) {
      await registers.create(iqac, 'FACULTY', {
        academicYearId: current,
        departmentId: cse,
        data: { name, designation: 'Assistant Professor', qualification: name === 'Dr. A' ? 'Ph.D.' : 'PG', employment: 'Full-time', dateOfJoining: '2018-07-01', experienceYears: 5, gender, sanctionedPost },
      });
    }
  });

  it('fills the blocks for the chosen year, with last year next to it and the programme split', async () => {
    const view = await aishe.view(iqac, current);
    expect(view.year.id).toBe(current);
    expect(view.previousYear?.id).toBe(locked);
    expect(item(view, 'programmes', 'onRoll').values).toEqual([800, 1200]);
    expect(item(view, 'programmes', 'admitted').values).toEqual([null, 66]); // No batches last year: not entered.
    expect(item(view, 'teaching', 'teachers').values[1]).toBe(3);
    expect(item(view, 'teaching', 'women').values[1]).toBe(2);
    expect(item(view, 'teaching', 'phd').values[1]).toBe(1);
    expect(item(view, 'phd', 'partTime').values[1]).toBeNull();
    const programmes = block(view, 'programmes').perProgram!;
    expect(programmes.itemKeys).not.toContain('onRoll');
    const cseRow = programmes.rows.find((r) => r.id === cseProgram)!;
    expect(cseRow.values[programmes.itemKeys.indexOf('admitted')]).toBe(66);
    const another = programmes.rows.find((r) => r.id !== cseProgram)!;
    expect(another.values.every((v) => v === null)).toBe(true);
    expect(view.percent).toBeGreaterThan(0);
  });

  it('finds the inconsistencies and says where to fix them', async () => {
    const view = await aishe.view(iqac, current);
    const found = codes(view);
    expect(found).toEqual(expect.arrayContaining(['SB-WOMEN', 'SB-CATEGORY', 'SB-INTAKE', 'SB-PASSED', 'FA-SANCTIONED', 'CH-ONROLL', 'PF-AISHE']));
    expect(found).not.toContain('SB-OUTCOME'); // 35 placed or studying further of 52 passed.
    expect(found).not.toContain('CF-PHD');
    expect(found).not.toContain('SB-APPEARED'); // 50 appeared of 66 admitted.
    const women = view.checks.findings.find((f) => f.code === 'SB-WOMEN')!;
    expect(women.level).toBe('error');
    expect(women.detail).toMatch(/^2026–30 · .+: Women 70, Admitted 66\.$/);
    expect(women.fix).toEqual({ label: 'Student batches', href: '/registers?register=STUDENT_BATCHES' });
    expect(view.checks.findings.find((f) => f.code === 'CH-ONROLL')!.detail).toMatch(/800 in 2025–26, 1,200 in 2026–27 \(up 50%\)/);
    expect(view.checks.findings.find((f) => f.code === 'FA-SANCTIONED')!.detail).toBe('Teachers against a sanctioned post 3, Sanctioned teaching posts 2.');
    // Errors first.
    const levels = view.checks.findings.map((f) => f.level);
    expect(levels.indexOf('check')).toBeGreaterThan(levels.lastIndexOf('error'));
    expect(view.checks.passed).toBeLessThan(view.checks.total);
  });
});

describe('Submitted figures', () => {
  it('flags a figure that differs from the registers or between portals', async () => {
    await aishe.setFigure(iqac, { academicYearId: current, portal: 'AISHE', key: 'onRoll', value: 1200, note: 'As typed on the AISHE portal' });
    let view = await aishe.setFigure(iqac, { academicYearId: current, portal: 'NIRF', key: 'onRoll', value: 1150 });
    const onRoll = view.figures.find((f) => f.key === 'onRoll')!;
    expect(onRoll.registers).toBe(1200);
    expect(onRoll.submitted.map((s) => [s.portal, s.value])).toEqual([
      ['AISHE', 1200],
      ['NIRF', 1150],
    ]);
    expect(codes(view)).toEqual(expect.arrayContaining(['SF-onRoll', 'SP-onRoll']));
    expect(view.checks.findings.filter((f) => f.code === 'SF-onRoll').map((f) => f.detail)).toEqual(['Submitted to NIRF: 1,150. Registers for 2026–27: 1,200.']);
    expect(view.checks.findings.find((f) => f.code === 'SP-onRoll')!.level).toBe('error');

    view = await aishe.setFigure(iqac, { academicYearId: current, portal: 'NIRF', key: 'onRoll', value: null });
    expect(codes(view).some((c) => c.endsWith('-onRoll'))).toBe(false);
  });

  it('refuses a portal that does not ask for the figure, an unknown figure, and another college’s year', async () => {
    expect(await codeOf(aishe.setFigure(iqac, { academicYearId: current, portal: 'AISHE', key: 'placed', value: 10 }))).toBe('invalid_input');
    expect(await codeOf(aishe.setFigure(iqac, { academicYearId: current, portal: 'AISHE', key: 'madeUp', value: 10 }))).toBe('invalid_input');
    const otherYear = await prisma.forTenant(otherAdmin.collegeId, (db) =>
      db.academicYear.create({ data: { collegeId: otherAdmin.collegeId, label: '2026-27', startDate: new Date('2026-07-01'), endDate: new Date('2027-06-30'), status: 'current' } }),
    );
    expect(await codeOf(aishe.setFigure(iqac, { academicYearId: otherYear.id, portal: 'AISHE', key: 'onRoll', value: 10 }))).toBe('not_found');
  });

  it('exports the data forms with the findings and submitted figures', async () => {
    const file = await aishe.sheet(iqac, current);
    expect(file.name).toBe('AISHE 2026–27 data forms.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.body as never);
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'Institution profile',
      'Programmes and admissions',
      'Examination results',
      'Teaching staff',
      'Non-teaching staff',
      'Ph.D.',
      'Scholarships, fee reimbursement',
      'Infrastructure',
      'Finance',
      'Checks',
      'Submitted figures',
    ]);
    const rows = (name: string) => {
      const out: string[] = [];
      workbook.getWorksheet(name)!.eachRow((row) => out.push((row.values as unknown[]).slice(1).join(' | ')));
      return out;
    };
    expect(rows('Programmes and admissions')).toContain('Students on roll, all programmes |  | 800 | 1200');
    expect(rows('Institution profile')).toContain('AISHE code | Not entered');
    expect(rows('Checks').some((r) => r.startsWith('Error | SB-WOMEN'))).toBe(true);
    expect(rows('Submitted figures').some((r) => r.startsWith('Students on roll |  | 1200 | 1200'))).toBe(true);
  });
});

describe('Who sees AISHE', () => {
  it('is for college-wide viewers; only those who maintain registers college-wide record submitted figures', async () => {
    expect((await aishe.view(principal)).can).toEqual({ assign: true, recordSubmitted: false });
    expect((await aishe.view(iqac)).can).toEqual({ assign: true, recordSubmitted: true });
    expect((await aishe.view(nirfCoordinator)).can.recordSubmitted).toBe(false);
    expect(await codeOf(aishe.setFigure(principal, { academicYearId: current, portal: 'AISHE', key: 'onRoll', value: 1 }))).toBe('forbidden');
    expect(await codeOf(aishe.view(office))).toBe('forbidden');
    expect(await codeOf(aishe.view(faculty))).toBe('forbidden');
  });

  it('shows another college only its own figures', async () => {
    const view = await aishe.view(otherAdmin);
    expect(view.figures.every((f) => f.submitted.length === 0 && f.registers === null)).toBe(true);
    expect(view.checks.findings.some((f) => f.code === 'PF-UNIVERSITY')).toBe(false); // An autonomous college.
  });
});
