// NBA SAR: which programs each person can report on, gaps listed before data exists, and the files compiled from a
// program's profile, locked course, registers, opened and read back.

import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccreditationService } from '../src/accreditation/accreditation.service.js';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { InProcessJobs } from '../src/jobs/jobs.js';
import { NbaService } from '../src/nba/nba.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { RegistersService } from '../src/registers/registers.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { MemoryStorage } from './memory-storage.js';

let database: Database;
let prisma: PrismaService;
let storage: MemoryStorage;
let reports: ReportsService;
let nba: NbaService;
let registers: RegistersService;
let iqac: AuthUser;
let hod: AuthUser;
let coordinator: AuthUser;
let faculty: AuthUser;
let cse: { id: string; name: string; departmentId: string };
let ece: string;
let year: string;
let sarId: string;

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof HttpException) return (error.getResponse() as { code: string }).code;
    throw error;
  }
  return 'no_error';
}

async function actor(email: string): Promise<AuthUser> {
  const collegeId = (await prisma.resolveCollegeId('sample'))!;
  const user = await prisma.forTenant(collegeId, (db) => db.user.findFirstOrThrow({ where: { collegeId, email }, include: { roles: true } }));
  return { id: user.id, collegeId, roles: user.roles.map(({ role, departmentId }) => ({ role, departmentId })) };
}

async function finished(who: AuthUser, id: string) {
  for (let i = 0; i < 200; i++) {
    const view = await reports.get(who, id);
    if (view.status === 'done' || view.status === 'failed') return view;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('export did not finish');
}

async function sheet(who: AuthUser, exportId: string, index: number, name: string): Promise<string[]> {
  const { url } = await reports.download(who, exportId, index);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(storage.files.get(url.replace('memory://', '').replace(/\?.*$/, ''))!.bytes) as never);
  const rows: string[] = [];
  workbook.getWorksheet(name)?.eachRow((row) => rows.push((row.values as unknown[]).slice(1).join(' | ')));
  return rows;
}

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (owner) => {
      await seed(owner);
      // ECE also uses an NBA engineering format, so there are two programs with a SAR.
      const college = await owner.college.findFirstOrThrow({ where: { subdomain: 'sample' } });
      const program = await owner.program.findFirstOrThrow({ where: { collegeId: college.id, department: { code: 'ECE' } } });
      const tier1 = await owner.framework.findFirstOrThrow({ where: { code: 'NBA_ENGG_TIER1' } });
      await owner.programFramework.create({ data: { collegeId: college.id, programId: program.id, frameworkId: tier1.id } });
    },
  });
  prisma = new PrismaService(database);
  storage = new MemoryStorage();
  const permissions = new PermissionsService(prisma);
  reports = new ReportsService(prisma, permissions, new AccreditationService(prisma), storage, new InProcessJobs());
  reports.onModuleInit();
  nba = new NbaService(prisma, permissions);
  registers = new RegistersService(prisma, permissions);
  iqac = await actor('iqac@sample-college.example');
  hod = await actor('hod.cse@sample-college.example');
  coordinator = await actor('nba@sample-college.example');
  faculty = await actor('faculty@sample-college.example');
  await prisma.forTenant(iqac.collegeId, async (db) => {
    const programs = await db.program.findMany({ where: { collegeId: iqac.collegeId }, include: { department: true } });
    const p = programs.find((x) => x.department.code === 'CSE')!;
    cse = { id: p.id, name: p.name, departmentId: p.departmentId };
    ece = programs.find((x) => x.department.code === 'ECE')!.id;
    year = (await db.academicYear.findFirstOrThrow({ where: { collegeId: iqac.collegeId, status: 'current' } })).id;
  });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Who can create which SAR', () => {
  it('gives college-wide and NBA reporters every NBA program, and a HOD only theirs', async () => {
    const programsOf = async (who: AuthUser) => (await reports.templates(who)).filter((t) => t.kind === 'SAR').map((t) => t.program!.id).sort();
    expect(await programsOf(iqac)).toEqual([cse.id, ece].sort());
    expect(await programsOf(coordinator)).toEqual([cse.id, ece].sort());
    expect(await programsOf(hod)).toEqual([cse.id]);
    expect(await reports.templates(faculty)).toEqual([]);
    const sar = (await reports.templates(hod)).find((t) => t.kind === 'SAR')!;
    sarId = sar.id;
    expect(sar.outputs).toEqual(['report', 'index', 'missing']);
    expect(await codeOf(reports.checks(hod, sarId, undefined, ece))).toBe('not_found');
  });

  it('keeps the NBA coordinator out of NAAC reports', async () => {
    const naac = (await reports.templates(iqac)).find((t) => t.kind === 'SSR')!;
    expect(await codeOf(reports.checks(coordinator, naac.id))).toBe('not_found');
  });
});

describe('Before anything is entered', () => {
  it('lists the gaps by criterion, and the criteria written by hand', async () => {
    const checks = await reports.checks(hod, sarId, year, cse.id);
    const texts = checks.issues.map((i) => i.text);
    expect(texts).toContain('Criterion 1: The vision is not entered (NBA page, Vision, mission and PEOs).');
    expect(texts.some((t) => t.startsWith('Criterion 2: No courses are entered'))).toBe(true);
    expect(texts.some((t) => /Criteria 7, 8, 9, 10 are not compiled/.test(t))).toBe(true);
    expect(checks.summary).toMatch(/^0 of the 6 criteria YuCampus compiles are complete for B\.Tech/);
  });
});

describe('Compiled from the program', () => {
  it('fills criteria 1 to 6 from the NBA page and the registers', async () => {
    await nba.setProfile(hod, cse.id, {
      vision: 'To be a centre of excellence in computing education.',
      mission: 'Teach well; do useful research; serve society.',
      peos: [{ code: 'peo1', statement: 'Graduates build reliable software for real users.' }],
    });
    await nba.setPsos(hod, cse.id, { psos: [{ code: 'PSO1', statement: 'Design and build software systems.' }] });
    const course = await nba.createCourse(hod, cse.id, { academicYearId: year, code: 'CS501', name: 'Machine Learning', semester: 5, teacherId: faculty.id });
    const withCos = await nba.setOutcomes(faculty, course.id, { outcomes: [{ code: 'CO1', statement: 'Explain supervised learning', indirectLevel: 2.5 }] });
    const co = withCos.outcomes[0]!.id;
    const po1 = withCos.programOutcomes.find((p) => p.code === 'PO1')!.id;
    await nba.setMapping(faculty, course.id, { cells: [{ courseOutcomeId: co, programOutcomeId: po1, strength: 3 }] });
    await nba.setResults(faculty, course.id, {
      results: [
        { courseOutcomeId: co, kind: 'internal', name: 'Test 1', attempted: 60, reached: 44 },
        { courseOutcomeId: co, kind: 'end_exam', name: 'End exam', attempted: 60, reached: 39 },
      ],
    });
    await nba.setLocked(hod, course.id, true);
    await registers.create(iqac, 'STUDENT_BATCHES', {
      academicYearId: year,
      data: { batch: '2022–26', program: cse.id, intake: 180, enrolled: 180, appearedFinal: 170, passedOnTime: 164, placed: 128, higherStudies: 14 },
    });
    await registers.create(iqac, 'FACULTY', {
      academicYearId: year,
      departmentId: cse.departmentId,
      data: { name: 'Dr. K. Rao', designation: 'Professor', qualification: 'Ph.D.', employment: 'Full-time', dateOfJoining: '2010-07-01', experienceYears: 16, fdpsThisYear: 2 },
    });
    await registers.create(iqac, 'RESEARCH', {
      academicYearId: year,
      departmentId: cse.departmentId,
      data: { title: 'Deep learning for X-rays', kind: 'Journal paper', ugcCare: true, authors: 'K. Rao', venue: 'Sample Journal', date: '2026-08-01' },
    });
    await registers.create(iqac, 'INFRA_FINANCE', {
      academicYearId: year,
      departmentId: cse.departmentId,
      data: { item: 'AI and ML lab', category: 'Laboratory', quantity: '60 systems', amountLakh: 40 },
    });

    const checks = await reports.checks(hod, sarId, year, cse.id);
    const texts = checks.issues.map((i) => i.text).join('\n');
    expect(texts).not.toMatch(/Criterion [1236]:/);
    // The earlier year in the span has no batches or faculty yet.
    expect(texts).toMatch(/Criterion 4: No student batches entered for 2025–26/);
  });

  it('creates the SAR files (no evidence pack), and they hold the program’s numbers', async () => {
    const started = await reports.create(hod, { templateId: sarId, programId: cse.id, academicYearId: year, outputs: ['report', 'index', 'pack', 'missing'] });
    expect(started.outputs).toEqual(['report', 'index', 'missing']);
    const done = await finished(hod, started.id);
    expect(done.error).toBeNull();
    expect(done.files.map((f) => f.name)).toEqual([
      `NBA SAR ${cse.name} 2026–27 - Report.docx`,
      `NBA SAR ${cse.name} 2026–27 - Report.pdf`,
      `NBA SAR ${cse.name} 2026–27 - Outcome data.xlsx`,
      `NBA SAR ${cse.name} 2026–27 - Missing items.xlsx`,
    ]);
    // CO1: internal 73.3% → 3, end exam 65% → 2; direct 2.4; final 2.4 × 0.8 + 2.5 × 0.2 = 2.42.
    expect(await sheet(hod, done.id, 2, 'C3 PO attainment')).toContain('PO1 | 2.42 | 1');
    expect(await sheet(hod, done.id, 2, 'C1 PEOs')).toContain('PEO1 | Graduates build reliable software for real users.');
    expect((await sheet(hod, done.id, 2, 'C4 Students')).some((r) => r.startsWith('2026–27 | 2022–26 | 180 | 180 | 170 | 164 | 128 | 14'))).toBe(true);
    expect((await sheet(hod, done.id, 2, 'C5 Faculty')).some((r) => r.startsWith('2026–27 | 1 | 1 | 0 | 0 | 1'))).toBe(true);
    const missing = await sheet(hod, done.id, 3, 'Missing items');
    expect(missing.some((r) => r.startsWith('7 |'))).toBe(true);
    const { url } = await reports.download(hod, done.id, 1);
    expect(new TextDecoder().decode(storage.files.get(url.replace('memory://', '').replace(/\?.*$/, ''))!.bytes.slice(0, 5))).toBe('%PDF-');
  });
});
