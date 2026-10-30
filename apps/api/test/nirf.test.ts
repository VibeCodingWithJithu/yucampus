// NIRF data readiness: categories, completeness per year, parameter and sub-parameter, values from the registers,
// gaps as "not entered" (never 0), the data sheets, and who may see it.

import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { NirfService } from '../src/nirf/nirf.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { RegistersService } from '../src/registers/registers.service.js';

let database: Database;
let prisma: PrismaService;
let nirf: NirfService;
let registers: RegistersService;
let coordinator: AuthUser;
let iqac: AuthUser;
let principal: AuthUser;
let faculty: AuthUser;
let office: AuthUser;
let otherAdmin: AuthUser;
let year: string;
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

const sub = (view: Awaited<ReturnType<NirfService['view']>>, code: string) => view.parameters.flatMap((p) => p.subs).find((s) => s.code === code)!;
const now = (values: (number | null)[]) => values[values.length - 1];

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
  nirf = new NirfService(prisma, permissions);
  registers = new RegistersService(prisma, permissions);
  coordinator = await actor('sample', 'nirf@sample-college.example');
  iqac = await actor('sample', 'iqac@sample-college.example');
  principal = await actor('sample', 'principal@sample-college.example');
  faculty = await actor('sample', 'faculty@sample-college.example');
  office = await actor('sample', 'office@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');
  await prisma.forTenant(iqac.collegeId, async (db) => {
    year = (await db.academicYear.findFirstOrThrow({ where: { collegeId: iqac.collegeId, status: 'current' } })).id;
    cse = (await db.department.findFirstOrThrow({ where: { collegeId: iqac.collegeId, code: 'CSE' } })).id;
  });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Before any data', () => {
  it('shows the engineering category, its parameters and weights, and nothing entered', async () => {
    const view = await nirf.view(coordinator);
    expect(view.category).toEqual({ code: 'NIRF_ENGINEERING', name: 'NIRF · Engineering' });
    expect(view.parameters.map((p) => [p.key, p.weight])).toEqual([
      ['TLR', 30],
      ['RP', 30],
      ['GO', 20],
      ['OI', 10],
      ['PR', 10],
    ]);
    expect(view.years.length).toBeGreaterThan(0);
    expect(view.years.every((y) => y.percent === 0)).toBe(true);
    const pr = view.parameters.find((p) => p.key === 'PR')!;
    expect(pr.percent).toBeNull();
    expect(pr.note).toMatch(/gathered by NIRF/);
    expect(view.source.verified).toBe(false);
  });
});

describe('From the registers', () => {
  it('fills the items from the registers, and says “not entered” for an empty field', async () => {
    await registers.create(iqac, 'COLLEGE_FIGURES', {
      academicYearId: year,
      data: { source: 'Office records', studentsOnRoll: 1200, sanctionedTeachingPosts: 80, expenditureExSalaryLakh: 250, studentComputers: 300, phdStudentsFullTime: 12, accessibleFacilities: true },
    });
    for (const [name, qualification, gender] of [['Dr. A', 'Ph.D.', 'Female'], ['Mr. B', 'PG', 'Male']]) {
      await registers.create(iqac, 'FACULTY', {
        academicYearId: year,
        departmentId: cse,
        data: { name, designation: 'Assistant Professor', qualification, employment: 'Full-time', dateOfJoining: '2018-07-01', experienceYears: name === 'Dr. A' ? 10 : 4, gender },
      });
    }
    await registers.create(iqac, 'RESEARCH', {
      academicYearId: year,
      departmentId: cse,
      data: { title: 'Smart grid fault detection', kind: 'Patent published', authors: 'A', venue: 'Patent office', date: '2026-08-01' },
    });

    const view = await nirf.view(coordinator);
    expect(sub(view, 'SS').items.map((i) => [i.key, now(i.values)])).toEqual([
      ['intake', null], // No student batches yet.
      ['onRoll', 1200],
      ['phdFull', 12],
      ['phdPart', null], // The yearly record exists but this field is empty.
    ]);
    expect(now(sub(view, 'FSR').items.find((i) => i.key === 'fullTime')!.values)).toBe(2);
    expect(sub(view, 'FQE').items.map((i) => now(i.values))).toEqual([1, 7]);
    expect(sub(view, 'IPR').items.map((i) => now(i.values))).toEqual([1, 0]);
    expect(now(sub(view, 'PCS').items[0]!.values)).toBe(1);
    expect(now(sub(view, 'WD').items.find((i) => i.key === 'womenFaculty')!.values)).toBe(1);
    expect(sub(view, 'GPHD').percent).toBe(0);
    expect(view.years[view.years.length - 1]!.percent).toBeGreaterThan(0);
    expect(view.years[0]!.percent).toBe(0);
  });

  it('exports the data sheets with every item for the years', async () => {
    const file = await nirf.sheet(coordinator);
    expect(file.name).toBe('NIRF Engineering data sheets.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.body as never);
    expect(workbook.worksheets.map((w) => w.name)).toEqual(['Summary', 'TLR', 'RP', 'GO', 'OI']);
    const rows: string[] = [];
    workbook.getWorksheet('TLR')!.eachRow((row) => rows.push((row.values as unknown[]).slice(1).join(' | ')));
    expect(rows.some((r) => r.startsWith('SS | Student strength including doctoral students | Students on roll |  |') && r.endsWith('| 1200'))).toBe(true);
    expect(rows.some((r) => r.includes('Ph.D. students (part-time)') && r.endsWith('Not entered'))).toBe(true);
  });
});

describe('Who sees NIRF', () => {
  it('is for the NIRF coordinator, IQAC and the principal', async () => {
    expect((await nirf.view(iqac)).category.code).toBe('NIRF_ENGINEERING');
    expect((await nirf.view(principal)).can.assign).toBe(true);
    expect((await nirf.view(coordinator)).can.assign).toBe(true);
    expect(await codeOf(nirf.view(faculty))).toBe('forbidden');
    expect(await codeOf(nirf.view(office))).toBe('forbidden');
  });

  it('tells a college without a NIRF category to choose one, and shows it nothing of another college', async () => {
    expect(await codeOf(nirf.view(otherAdmin))).toBe('no_framework');
  });
});
