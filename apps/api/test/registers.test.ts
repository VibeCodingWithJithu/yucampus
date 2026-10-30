// Data registers: who sees and edits what, values checked against the configured fields, proof, Excel import,
// copying a year, locked years, the definition guard, and tenancy.

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { HttpException } from '@nestjs/common';
import { createEvidenceSchema, registerQuerySchema, reviewSchema } from '@yucampus/validation';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccreditationService } from '../src/accreditation/accreditation.service.js';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { AppConfig } from '../src/config.js';
import { EvidenceService } from '../src/evidence/evidence.service.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { RegistersService } from '../src/registers/registers.service.js';
import { importRegister } from '../src/rules/import-register.js';
import { TemplateImportError } from '../src/rules/import-template.js';
import { MemoryStorage } from './memory-storage.js';
import { notificationsFor } from './notifications-for.js';

let database: Database;
let owner: PrismaClient;
let prisma: PrismaService;
let storage: MemoryStorage;
let registers: RegistersService;
let evidence: EvidenceService;
let admin: AuthUser;
let iqac: AuthUser;
let hod: AuthUser;
let faculty: AuthUser;
let office: AuthUser;
let principal: AuthUser;
let otherAdmin: AuthUser;
let years: { current: string; next: string; locked: string };
let departments: Record<string, string>;
let programs: Record<string, string>;

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
  const user = await prisma.forTenant(collegeId, (db) =>
    db.user.findFirstOrThrow({ where: { collegeId, email }, include: { roles: true } }),
  );
  return { id: user.id, collegeId, roles: user.roles.map(({ role, departmentId }) => ({ role, departmentId })) };
}

/** Runs as the database owner (rules are read-only for the app role), then drops back to the app role. */
async function asOwner<T>(work: () => Promise<T>): Promise<T> {
  await owner.$executeRawUnsafe('RESET ROLE');
  try {
    return await work();
  } finally {
    await owner.$executeRawUnsafe('SET ROLE yucampus_app');
  }
}

const page = (who: AuthUser, code: string, query: Record<string, string> = {}) => registers.page(who, code, registerQuerySchema.parse(query));
const profile = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  designation: 'Assistant Professor',
  qualification: 'Ph.D.',
  employment: 'Full-time',
  dateOfJoining: '2019-07-01',
  experienceYears: 7,
  ...extra,
});

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (db) => {
      owner = db;
      await seed(db);
      const other = await db.college.create({ data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' } });
      await db.academicYear.create({
        data: { collegeId: other.id, label: '2026-27', startDate: new Date('2026-07-01'), endDate: new Date('2027-06-30'), status: 'current' },
      });
      await db.user.create({
        data: { collegeId: other.id, name: 'Other College Admin', email: 'admin@other-college.example', status: 'active', roles: { create: [{ collegeId: other.id, role: 'college_admin' }] } },
      });
    },
  });
  prisma = new PrismaService(database);
  storage = new MemoryStorage();
  const permissions = new PermissionsService(prisma);
  registers = new RegistersService(prisma, permissions);
  evidence = new EvidenceService(prisma, storage, permissions, new AppConfig(), new AccreditationService(prisma), notificationsFor(prisma));
  admin = await actor('sample', 'admin@sample-college.example');
  iqac = await actor('sample', 'iqac@sample-college.example');
  hod = await actor('sample', 'hod.cse@sample-college.example');
  faculty = await actor('sample', 'faculty@sample-college.example');
  office = await actor('sample', 'office@sample-college.example');
  principal = await actor('sample', 'principal@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');
  await prisma.forTenant(iqac.collegeId, async (db) => {
    const ys = await db.academicYear.findMany({ where: { collegeId: iqac.collegeId } });
    years = {
      current: ys.find((y) => y.status === 'current')!.id,
      next: ys.find((y) => y.status === 'next')!.id,
      locked: ys.find((y) => y.status === 'locked')!.id,
    };
    departments = Object.fromEntries((await db.department.findMany({ where: { collegeId: iqac.collegeId } })).map((d) => [d.code, d.id]));
    programs = Object.fromEntries((await db.program.findMany({ where: { collegeId: iqac.collegeId }, include: { department: true } })).map((p) => [p.department.code, p.id]));
  });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Who sees which registers', () => {
  it('shows IQAC and office all six, ready to add', async () => {
    for (const who of [iqac, office]) {
      const list = await registers.list(who);
      expect(list.map((r) => r.code)).toEqual(['FACULTY', 'STUDENT_BATCHES', 'RESEARCH', 'ACTIVITIES', 'INFRA_FINANCE', 'COLLEGE_FIGURES']);
      expect(list.every((r) => r.can.add && r.records === 0 && !r.verified)).toBe(true);
    }
  });

  it('lets the principal read but not add', async () => {
    const list = await registers.list(principal);
    expect(list).toHaveLength(6);
    expect(list.every((r) => !r.can.add)).toBe(true);
  });

  it('gives faculty only the registers about people: their profile and their research', async () => {
    expect((await registers.list(faculty)).map((r) => r.code)).toEqual(['FACULTY', 'RESEARCH']);
    expect(await codeOf(page(faculty, 'ACTIVITIES'))).toBe('not_found');
  });
});

describe('Adding and changing records', () => {
  let facultyProfile: string;

  it('checks values against the configured fields', async () => {
    const base = { academicYearId: years.current, departmentId: departments.CSE };
    expect(await codeOf(registers.create(iqac, 'FACULTY', { ...base, data: profile('Dr. Test', { designation: 'Dean of everything' }) }))).toBe('invalid_input');
    expect(await codeOf(registers.create(iqac, 'FACULTY', { ...base, data: profile('Dr. Test', { experienceYears: 99 }) }))).toBe('invalid_input');
    expect(await codeOf(registers.create(iqac, 'FACULTY', { ...base, data: profile('') }))).toBe('invalid_input');
  });

  it('saves an incomplete record and counts what is missing', async () => {
    const saved = await registers.create(iqac, 'FACULTY', {
      academicYearId: years.current,
      departmentId: departments.CSE,
      userId: faculty.id,
      data: { name: 'Sample Faculty', designation: 'assistant professor', qualification: 'Ph.D.' },
    });
    expect(saved.data.designation).toBe('Assistant Professor');
    expect(saved.missing.sort()).toEqual(['dateOfJoining', 'employment', 'experienceYears']);
    expect(saved.person?.name).toBe('Sample Faculty');
    facultyProfile = saved.id;
    const list = await registers.list(iqac);
    expect(list.find((r) => r.code === 'FACULTY')).toMatchObject({ records: 1, incomplete: 1 });
  });

  it('lets faculty complete their own profile, and nobody else’s', async () => {
    const mine = await page(faculty, 'FACULTY');
    expect(mine.items.map((i) => i.id)).toEqual([facultyProfile]);
    expect(mine.items[0]!.can.edit).toBe(true);
    const updated = await registers.update(faculty, facultyProfile, {
      academicYearId: years.current,
      departmentId: departments.CSE,
      data: profile('Sample Faculty'),
    });
    expect(updated.missing).toEqual([]);
    expect(updated.person?.id).toBe(faculty.id);

    const someoneElse = await registers.create(iqac, 'FACULTY', { academicYearId: years.current, departmentId: departments.ECE, data: profile('Dr. ECE Person') });
    expect(await codeOf(registers.update(faculty, someoneElse.id, { academicYearId: years.current, data: profile('Hacked') }))).toBe('not_found');
    expect((await page(faculty, 'FACULTY')).items).toHaveLength(1);
  });

  it('links research added by faculty to themselves', async () => {
    const paper = await registers.create(faculty, 'RESEARCH', {
      academicYearId: years.current,
      userId: hod.id,
      data: { title: 'IoT in agriculture', kind: 'Journal paper', authors: 'S. Faculty', venue: 'Sample Journal of IoT', date: '2026-08-01' },
    });
    expect(paper.person?.id).toBe(faculty.id);
    expect(paper.missing).toEqual(['proof']);
  });

  it('keeps a HOD to their department', async () => {
    const cse = await registers.create(hod, 'ACTIVITIES', {
      academicYearId: years.current,
      departmentId: departments.CSE,
      data: { title: 'Guest lecture on cloud', kind: 'Guest lecture', startDate: '2026-10-09', participants: 140 },
    });
    expect(cse.can.edit).toBe(true);
    expect(
      await codeOf(
        registers.create(hod, 'ACTIVITIES', {
          academicYearId: years.current,
          departmentId: departments.ECE,
          data: { title: 'ECE visit', kind: 'Industrial visit', startDate: '2026-09-15', participants: 60 },
        }),
      ),
    ).toBe('department_only');
    const faculties = await page(hod, 'FACULTY');
    expect(faculties.items.every((i) => i.department?.code === 'CSE')).toBe(true);
  });

  it('takes the department from the program for student batches', async () => {
    const batch = await registers.create(hod, 'STUDENT_BATCHES', {
      academicYearId: years.current,
      data: { batch: '2022–26', program: programs.CSE, enrolled: 180, passedOnTime: 164, placed: 128, higherStudies: 14 },
    });
    expect(batch.department?.code).toBe('CSE');
    expect(await codeOf(registers.create(hod, 'STUDENT_BATCHES', { academicYearId: years.current, data: { batch: '2022–26', program: programs.ECE, enrolled: 120 } }))).toBe(
      'department_only',
    );
  });

  it('accepts only approved evidence as proof', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\n% proof\n');
    const ticket = await evidence.requestUpload(faculty, {
      fileName: 'Paper.pdf',
      contentType: 'application/pdf',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    storage.put(ticket.url.replace('memory://', ''), bytes, 'application/pdf');
    const item = await evidence.create(faculty, createEvidenceSchema.parse({ uploadToken: ticket.uploadToken, title: 'Paper first page', documentDate: '2026-08-01' }));
    const paper = (await page(faculty, 'RESEARCH')).items[0]!;
    const input = { academicYearId: years.current, data: paper.data, proofIds: [item.id] };
    expect(await codeOf(registers.update(faculty, paper.id, input))).toBe('invalid_input');
    await evidence.review(hod, item.id, reviewSchema.parse({ decision: 'approve' }) as never);
    await evidence.review(iqac, item.id, reviewSchema.parse({ decision: 'approve' }) as never);
    const proven = await registers.update(faculty, paper.id, input);
    expect(proven.proofs.map((p) => p.title)).toEqual(['Paper first page']);
    expect(proven.missing).toEqual([]);
  });

  it('does not let the principal change records', async () => {
    expect(await codeOf(registers.create(principal, 'FACULTY', { academicYearId: years.current, departmentId: departments.CSE, data: profile('Dr. P') }))).toBe('forbidden');
  });
});

describe('College figures', () => {
  const figures = { source: 'Office records', studentsOnRoll: 1200, sanctionedTeachingPosts: 80, expenditureExSalaryLakh: 250, studentComputers: 300 };

  it('keeps one record a year', async () => {
    await registers.create(iqac, 'COLLEGE_FIGURES', { academicYearId: years.current, data: figures });
    expect(await codeOf(registers.create(office, 'COLLEGE_FIGURES', { academicYearId: years.current, data: figures }))).toBe('one_per_year');
    const imported = await registers.import(iqac, 'COLLEGE_FIGURES', { academicYearId: years.current, rows: [{ data: figures }], dryRun: true });
    expect(imported.problems[0]?.message).toContain('already has its record for this year');
  });
});

describe('Years', () => {
  it('keeps a locked year read only', async () => {
    expect(await codeOf(registers.create(iqac, 'FACULTY', { academicYearId: years.locked, departmentId: departments.CSE, data: profile('Dr. Old') }))).toBe('year_locked');
  });

  it('copies last year’s records into an empty year, once', async () => {
    const before = (await page(iqac, 'FACULTY', { year: years.next })).copyFrom;
    expect(before?.records).toBe(2);
    expect(await registers.copy(iqac, 'FACULTY', years.next)).toEqual({ copied: 2 });
    expect((await page(iqac, 'FACULTY', { year: years.next })).total).toBe(2);
    expect(await codeOf(registers.copy(iqac, 'FACULTY', years.next))).toBe('not_empty');
  });
});

describe('Excel', () => {
  it('checks every row first and saves all or nothing', async () => {
    const rows = [
      { departmentCode: 'ECE', data: profile('Ms. S. Devi', { qualification: 'PG with NET/SET/SLET' }) },
      { departmentCode: 'XYZ', data: profile('Dr. Nowhere') },
      { departmentCode: 'MECH', data: profile('Dr. Bad Choice', { employment: 'Sometimes' }) },
    ];
    const checked = await registers.import(office, 'FACULTY', { academicYearId: years.current, rows, dryRun: false });
    expect(checked.saved).toBe(false);
    expect(checked.problems.map((p) => p.row)).toEqual([3, 4]);
    expect(checked.problems[0]!.message).toContain('XYZ');
    expect(checked.problems[1]!.message).toContain('Employment');
    const before = (await page(iqac, 'FACULTY')).total;
    const saved = await registers.import(office, 'FACULTY', { academicYearId: years.current, rows: [rows[0]!], dryRun: false });
    expect(saved).toEqual({ created: 1, problems: [], saved: true });
    expect((await page(iqac, 'FACULTY')).total).toBe(before + 1);
  });

  it('matches programs by name and people by email', async () => {
    const result = await registers.import(iqac, 'STUDENT_BATCHES', {
      academicYearId: years.current,
      dryRun: true,
      rows: [{ data: { batch: '2024–26', program: 'MBA', enrolled: 60 } }, { data: { batch: '2024–26', program: 'MBA Online', enrolled: 30 } }],
    });
    expect(result.problems).toEqual([{ row: 3, message: 'Program: there is no program called "MBA Online".' }]);
  });

  it('offers a blank sheet with the columns and allowed choices', async () => {
    const sheet = await registers.sheet(iqac, 'FACULTY');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(sheet.body as never);
    const headings = (workbook.worksheets[0]!.getRow(1).values as string[]).slice(1);
    expect(headings.slice(0, 3)).toEqual(['Department code', 'YuCampus account (email)', 'Name']);
    expect(headings).toContain('Teaching experience (years)');
    expect(await codeOf(registers.sheet(principal, 'FACULTY'))).toBe('forbidden');
    // Faculty edit only their own records, so bulk import is not for them.
    expect(await codeOf(registers.import(faculty, 'FACULTY', { academicYearId: years.current, rows: [{ data: profile('Me again') }] }))).toBe('forbidden');
    expect((await registers.list(faculty)).every((r) => r.can.add && !r.can.import)).toBe(true);
  });
});

describe('Rules and tenancy', () => {
  it('refuses to drop a field that records use', async () => {
    const file = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../rules/registers/faculty.json'), 'utf8'));
    file.fields = file.fields.filter((f: { key: string }) => f.key !== 'experienceYears');
    await expect(asOwner(() => importRegister(owner, file))).rejects.toBeInstanceOf(TemplateImportError);
    // Adding a field is fine.
    const added = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../rules/registers/faculty.json'), 'utf8'));
    added.fields.push({ key: 'orcid', label: 'ORCID iD', type: 'text' });
    expect((await asOwner(() => importRegister(owner, added))).created).toBe(false);
  });

  it('shows another college nothing', async () => {
    const list = await registers.list(otherAdmin);
    expect(list.every((r) => r.records === 0)).toBe(true);
    const any = (await page(iqac, 'FACULTY')).items[0]!;
    expect(await codeOf(registers.record(otherAdmin, any.id))).toBe('not_found');
    expect(await codeOf(registers.update(admin, any.id, { academicYearId: years.current, departmentId: departments.CSE, data: profile('Admin edit') }))).toBe('no_error');
  });
});
