// Metrics fed by the data registers: counts, sums and ratios per year, "not entered" versus zero, department scope,
// and the numbers in reports.

import 'reflect-metadata';
import { metricDataSchema, registerQuerySchema } from '@yucampus/validation';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccreditationService } from '../src/accreditation/accreditation.service.js';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { InProcessJobs } from '../src/jobs/jobs.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { RegistersService } from '../src/registers/registers.service.js';
import { metricData, parseDataSource } from '../src/registers/metric-data.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { MemoryStorage } from './memory-storage.js';

let database: Database;
let prisma: PrismaService;
let accreditation: AccreditationService;
let registers: RegistersService;
let reports: ReportsService;
let storage: MemoryStorage;
let iqac: AuthUser;
let year: string;
let departments: Record<string, string>;
let programs: Record<string, string>;
const metricIds: Record<string, string> = {};

async function actor(email: string): Promise<AuthUser> {
  const collegeId = (await prisma.resolveCollegeId('sample'))!;
  const user = await prisma.forTenant(collegeId, (db) => db.user.findFirstOrThrow({ where: { collegeId, email }, include: { roles: true } }));
  return { id: user.id, collegeId, roles: user.roles.map(({ role, departmentId }) => ({ role, departmentId })) };
}

const teacher = (name: string, department: string, qualification: string, employment = 'Full-time') =>
  registers.create(iqac, 'FACULTY', {
    academicYearId: year,
    departmentId: departments[department],
    data: { name, designation: 'Assistant Professor', qualification, employment, dateOfJoining: '2019-07-01', experienceYears: 5 },
  });
const research = (title: string, kind: string, ugcCare: boolean | null, department = 'CSE') =>
  registers.create(iqac, 'RESEARCH', {
    academicYearId: year,
    departmentId: departments[department],
    data: { title, kind, ugcCare, authors: 'A. Author', venue: 'Sample Journal', date: '2026-08-01' },
  });
const dataOf = async (code: string) => (await accreditation.metric(iqac, metricIds[code]!)).data!;
const current = (data: Awaited<ReturnType<typeof dataOf>>) => data.years[data.years.length - 1]!;

beforeAll(async () => {
  database = await openLocalDatabase({ setup: (owner) => seed(owner) });
  prisma = new PrismaService(database);
  storage = new MemoryStorage();
  const permissions = new PermissionsService(prisma);
  accreditation = new AccreditationService(prisma);
  registers = new RegistersService(prisma, permissions);
  reports = new ReportsService(prisma, permissions, accreditation, storage, new InProcessJobs());
  reports.onModuleInit();
  iqac = await actor('iqac@sample-college.example');
  await prisma.forTenant(iqac.collegeId, async (db) => {
    year = (await db.academicYear.findFirstOrThrow({ where: { collegeId: iqac.collegeId, status: 'current' } })).id;
    departments = Object.fromEntries((await db.department.findMany({ where: { collegeId: iqac.collegeId } })).map((d) => [d.code, d.id]));
    programs = Object.fromEntries((await db.program.findMany({ where: { collegeId: iqac.collegeId }, include: { department: true } })).map((p) => [p.department.code, p.id]));
    const active = await accreditation.activeFrameworkIds(db, iqac.collegeId);
    for (const m of await db.metric.findMany({ where: { criterion: { frameworkId: { in: active } }, code: { in: ['2.4.2', '3.3.1', '5.2.1', '1.1.1', '2.1.1', '2.2.1', '4.1.2', '6.3.3'] } } })) {
      metricIds[m.code] = m.id;
    }
  });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Metric numbers from registers', () => {
  it('says "not entered" before any records, and maps only metrics the registers can serve', async () => {
    const papers = await dataOf('3.3.1');
    expect(papers.measures.map((m) => m.label)).toEqual(['Papers in UGC CARE journals', 'Full-time teachers']);
    expect(papers.years.length).toBeGreaterThan(0);
    expect(papers.years.every((y) => y.values.every((v) => v === null) && y.ratios.every((r) => r === null))).toBe(true);
    expect((await accreditation.metric(iqac, metricIds['1.1.1']!)).data).toBeNull();
  });

  it('counts only matching records: full-time teachers, UGC CARE journal papers', async () => {
    await teacher('Dr. A', 'CSE', 'Ph.D.');
    await teacher('Dr. B', 'CSE', 'PG with NET/SET/SLET');
    await teacher('Mr. C', 'ECE', 'PG');
    await teacher('Dr. Visiting', 'CSE', 'Ph.D.', 'Visiting');
    await research('Paper one', 'Journal paper', true);
    await research('Paper two', 'Journal paper', true, 'ECE');
    await research('Not in CARE', 'Journal paper', false);
    await research('A chapter', 'Book chapter', null);

    const papers = current(await dataOf('3.3.1'));
    expect(papers.values).toEqual([2, 3]);
    expect(papers.ratios).toEqual([0.67]);

    const qualified = current(await dataOf('2.4.2'));
    expect(qualified.values).toEqual([3, 2]);
    expect(qualified.ratios).toEqual([66.7]);
  });

  it('adds up several fields and leaves other years as not entered', async () => {
    await registers.create(iqac, 'STUDENT_BATCHES', {
      academicYearId: year,
      data: { batch: '2022–26', program: programs.CSE, enrolled: 180, intake: 180, passedOnTime: 164, placed: 128, higherStudies: 14 },
    });
    const outcomes = await dataOf('5.2.1');
    expect(current(outcomes).values).toEqual([142, 164]);
    expect(current(outcomes).ratios).toEqual([86.6]);
    expect(outcomes.years.slice(0, -1).every((y) => y.values.every((v) => v === null))).toBe(true);
  });

  it('counts only a department’s records for a HOD’s view', async () => {
    const source = parseDataSource((await prisma.rules.metric.findUniqueOrThrow({ where: { id: metricIds['3.3.1']! } })).dataSource)!;
    const cse = await prisma.forTenant(iqac.collegeId, (db) => metricData(db, iqac.collegeId, source, [{ id: year, label: '2026-27' }], [departments.CSE!]));
    expect(cse.years[0]!.values).toEqual([1, 2]);
  });

  it('ignores a stored source that does not match the format, rather than guessing', () => {
    expect(parseDataSource({ measures: [] })).toBeNull();
    expect(
      metricDataSchema.safeParse({
        measures: [{ key: 'a', label: 'Things', register: 'RESEARCH', op: 'count' }],
        ratios: [{ label: 'Bad ratio', numerator: 'a', denominator: 'missing', format: 'per' }],
      }).success,
    ).toBe(false);
  });
});

describe('Ratios against college figures', () => {
  it('divides by the college totals and counts teachers with at least one FDP', async () => {
    await registers.create(iqac, 'COLLEGE_FIGURES', {
      academicYearId: year,
      data: { source: 'Office records', studentsOnRoll: 60, sanctionedTeachingPosts: 4, expenditureExSalaryLakh: 200, studentComputers: 30 },
    });
    await registers.create(iqac, 'INFRA_FINANCE', { academicYearId: year, data: { item: 'AI lab', category: 'Capital expenditure', amountLakh: 50 } });
    const records = await registers.page(iqac, 'FACULTY', registerQuerySchema.parse({}));
    const drA = records.items.find((i) => i.title === 'Dr. A')!;
    await registers.update(iqac, drA.id, { academicYearId: year, departmentId: departments.CSE, data: { ...drA.data, fdpsThisYear: 2 } });

    expect(current(await dataOf('2.2.1')).ratios).toEqual([20]); // 60 students, 3 full-time teachers
    const spend = current(await dataOf('4.1.2'));
    expect(spend.values).toEqual([50, 200]);
    expect(spend.ratios).toEqual([25]);
    expect(current(await dataOf('6.3.3')).ratios).toEqual([33.3]); // 1 of 3
  });
});

describe('In reports', () => {
  it('lists the numbers in the evidence index and flags years not entered', async () => {
    const ssr = (await reports.templates(iqac)).find((t) => t.kind === 'SSR')!;
    const checks = await reports.checks(iqac, ssr.id);
    expect(checks.issues.some((i) => i.link === '/registers' && /register data that has not been entered/.test(i.text))).toBe(true);

    const started = await reports.create(iqac, { templateId: ssr.id, outputs: ['index'] });
    let view = await reports.get(iqac, started.id);
    for (let i = 0; i < 200 && !['done', 'failed'].includes(view.status); i++) {
      await new Promise((r) => setTimeout(r, 50));
      view = await reports.get(iqac, started.id);
    }
    expect(view.status).toBe('done');
    const { url } = await reports.download(iqac, view.id, 0);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(storage.files.get(url.replace('memory://', '').replace(/\?.*$/, ''))!.bytes) as never);
    const rows: string[] = [];
    workbook.getWorksheet('Register data')!.eachRow((row) => rows.push((row.values as unknown[]).slice(1).join(' | ')));
    expect(rows.some((r) => r.startsWith('3.3.1 |') && r.includes('Papers per full-time teacher') && r.includes('0.67'))).toBe(true);
    expect(rows.some((r) => r.includes('Not entered'))).toBe(true);
  });
});
