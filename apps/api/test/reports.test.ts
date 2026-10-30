// Reports and export: which reports, fix-before-export checks, the files themselves (opened and read back),
// department scope, one export at a time, failures, and tenancy.

import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { createEvidenceSchema, reviewSchema, taskInputSchema } from '@yucampus/validation';
import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccreditationService } from '../src/accreditation/accreditation.service.js';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { AppConfig } from '../src/config.js';
import { EvidenceService } from '../src/evidence/evidence.service.js';
import { InProcessJobs } from '../src/jobs/jobs.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { TasksService } from '../src/tasks/tasks.service.js';
import { MemoryStorage } from './memory-storage.js';
import { notificationsFor } from './notifications-for.js';

const PDF = new TextEncoder().encode('%PDF-1.4\n% report evidence\n');

let database: Database;
let prisma: PrismaService;
let storage: MemoryStorage;
let reports: ReportsService;
let evidence: EvidenceService;
let tasks: TasksService;
let iqac: AuthUser;
let hod: AuthUser;
let faculty: AuthUser;
let nba: AuthUser;
let otherAdmin: AuthUser;
let metric: { id: string; code: string; documentKey: string; secondKey: string | null };
let ssr: string;
let aqar: string;
let approvedId: string;

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

async function upload(who: AuthUser, title: string, link?: { metricId: string; documentKey: string }) {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% ${title}\n`);
  const ticket = await evidence.requestUpload(who, {
    fileName: 'Proof.pdf',
    contentType: 'application/pdf',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  storage.put(ticket.url.replace('memory://', ''), bytes, 'application/pdf');
  return evidence.create(who, createEvidenceSchema.parse({ uploadToken: ticket.uploadToken, title, documentDate: '2026-08-20', ...link }));
}
const approve = (who: AuthUser, id: string) => evidence.review(who, id, reviewSchema.parse({ decision: 'approve' }) as never);

/** Waits for the background job to finish the export. */
async function finished(who: AuthUser, id: string) {
  for (let i = 0; i < 200; i++) {
    const view = await reports.get(who, id);
    if (view.status === 'done' || view.status === 'failed') return view;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('export did not finish');
}
async function fileOf(who: AuthUser, id: string, index: number) {
  const { url } = await reports.download(who, id, index);
  return storage.files.get(url.replace('memory://', '').replace(/\?.*$/, ''))!.bytes;
}
async function sheetRows(bytes: Uint8Array, name: string): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const rows: string[] = [];
  workbook.getWorksheet(name)?.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map((v) => String(v ?? '')).join(' | ')));
  return rows;
}

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (owner) => {
      await seed(owner);
      const other = await owner.college.create({
        data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' },
      });
      await owner.user.create({
        data: {
          collegeId: other.id,
          name: 'Other College Admin',
          email: 'admin@other-college.example',
          status: 'active',
          roles: { create: [{ collegeId: other.id, role: 'college_admin' }] },
        },
      });
    },
  });
  prisma = new PrismaService(database);
  storage = new MemoryStorage();
  const permissions = new PermissionsService(prisma);
  const accreditation = new AccreditationService(prisma);
  const notifications = notificationsFor(prisma);
  const jobs = new InProcessJobs();
  reports = new ReportsService(prisma, permissions, accreditation, storage, jobs);
  reports.onModuleInit();
  evidence = new EvidenceService(prisma, storage, permissions, new AppConfig(), accreditation, notifications);
  tasks = new TasksService(prisma, permissions, notifications, accreditation, jobs);
  iqac = await actor('sample', 'iqac@sample-college.example');
  hod = await actor('sample', 'hod.cse@sample-college.example');
  faculty = await actor('sample', 'faculty@sample-college.example');
  nba = await actor('sample', 'nba@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');

  await prisma.forTenant(iqac.collegeId, async (db) => {
    const active = await accreditation.activeFrameworkIds(db, iqac.collegeId);
    const metrics = await db.metric.findMany({ where: { criterion: { frameworkId: { in: active } } }, orderBy: { code: 'asc' } });
    const m = metrics.find((x) => Array.isArray(x.requiredDocuments) && x.requiredDocuments.length > 1) ?? metrics[0]!;
    const docs = m.requiredDocuments as { key: string }[];
    metric = { id: m.id, code: m.code, documentKey: docs[0]!.key, secondKey: docs[1]?.key ?? null };
  });

  // One approved item for the metric, one approved but not linked, one still waiting.
  const item = await upload(faculty, 'Workshop proof', { metricId: metric.id, documentKey: metric.documentKey });
  await approve(hod, item.id);
  await approve(iqac, item.id);
  approvedId = item.id;
  const loose = await upload(faculty, 'Unlinked circular');
  await approve(hod, loose.id);
  await approve(iqac, loose.id);
  await upload(faculty, 'Waiting minutes', { metricId: metric.id, documentKey: metric.documentKey });
  if (metric.secondKey) {
    await tasks.create(
      iqac,
      taskInputSchema.parse({ title: 'Second proof please', metricId: metric.id, documentKey: metric.secondKey, assignee: { kind: 'user', id: faculty.id }, dueDate: '2026-12-01' }),
    );
  }
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Choosing a report', () => {
  it('offers SSR and AQAR for the active NAAC framework, then each NBA program’s SAR', async () => {
    const list = (await reports.templates(iqac)).filter((t) => !t.program);
    expect(list.map((t) => t.kind)).toEqual(['SSR', 'AQAR']);
    expect((await reports.templates(iqac)).filter((t) => t.program).map((t) => t.kind)).toEqual(['SAR']);
    expect(list.map((t) => t.period)).toEqual(['cycle', 'year']);
    ssr = list[0]!.id;
    aqar = list[1]!.id;
    expect(list[0]!.framework.verified).toBe(false);
  });

  it('offers nothing to people who cannot create NAAC reports', async () => {
    expect(await reports.templates(faculty)).toEqual([]);
    // The NBA coordinator gets SARs only.
    expect((await reports.templates(nba)).map((t) => t.kind)).toEqual(['SAR']);
    expect(await codeOf(reports.checks(faculty, ssr))).toBe('forbidden');
  });
});

describe('Fix before export', () => {
  it('lists gaps per criterion and things to check', async () => {
    const checks = await reports.checks(iqac, ssr);
    expect(checks.covered).toBe(1);
    expect(checks.missing).toBeGreaterThan(10);
    expect(checks.issues.filter((i) => i.level === 'must').length).toBeGreaterThan(0);
    const texts = checks.issues.map((i) => i.text).join('\n');
    expect(texts).toContain('not yet checked against the official manual');
    expect(texts).toContain('1 document linked to metrics is still waiting for approval');
    expect(texts).toContain('1 approved document is not linked to any metric');
  });
});

describe('Creating files', () => {
  let exportId: string;

  it('creates every file in the background, one export at a time', async () => {
    const started = await reports.create(iqac, { templateId: ssr, outputs: ['report', 'index', 'pack', 'missing'] });
    expect(started.status).toBe('queued');
    expect(await codeOf(reports.create(iqac, { templateId: ssr, outputs: ['index'] }))).toBe('export_running');
    const done = await finished(iqac, started.id);
    expect(done.error).toBeNull();
    expect(done.status).toBe('done');
    expect(done.files.map((f) => f.kind)).toEqual(['docx', 'pdf', 'xlsx', 'xlsx', 'zip']);
    expect(done.files.map((f) => f.name)).toEqual(expect.arrayContaining([expect.stringMatching(/ - Evidence pack\.zip$/)]));
    expect(done.formatVersion).toContain('layout 1');
    exportId = done.id;
  });

  it('makes a real Word file and PDF', async () => {
    const docx = await fileOf(iqac, exportId, 0);
    expect(new TextDecoder().decode(docx.slice(0, 2))).toBe('PK');
    const pdf = await fileOf(iqac, exportId, 1);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
  });

  it('indexes approved evidence and marks the rest missing', async () => {
    const criterion = metric.code.split('.')[0];
    const rows = await sheetRows(await fileOf(iqac, exportId, 2), `C${criterion}`);
    const proof = rows.find((r) => r.includes('Workshop proof'));
    expect(proof).toContain('Approved');
    expect(proof).toContain(`${metric.code}/1. `);
    expect(rows.some((r) => r.includes('Waiting minutes'))).toBe(false);
    expect(rows.some((r) => r.includes('Missing'))).toBe(true);
  });

  it('lists missing documents with the task that asks for them', async () => {
    const rows = await sheetRows(await fileOf(iqac, exportId, 3), 'Missing items');
    expect(rows.length).toBeGreaterThan(5);
    if (metric.secondKey) expect(rows.find((r) => r.includes('Second proof please'))).toContain('Sample Faculty');
  });

  it('packs the approved file in its criterion and metric folder, with the index and a read-me', async () => {
    const zip = unzipSync(await fileOf(iqac, exportId, 4));
    const names = Object.keys(zip);
    expect(names).toContain('Read me.txt');
    expect(names).toContain('Index.xlsx');
    const file = names.find((n) => n.includes('Workshop proof'))!;
    expect(file).toMatch(new RegExp(`^C\\d+ [^/]+/${metric.code.replace(/\./g, '\\.')}/1\\. .+\\.pdf$`));
    expect(new TextDecoder().decode(zip[file])).toContain('Workshop proof');
    expect(names.some((n) => n.includes('Unlinked circular') || n.includes('Waiting minutes'))).toBe(false);
  });

  it('keeps an AQAR to its academic year', async () => {
    const years = await prisma.forTenant(iqac.collegeId, (db) => db.academicYear.findMany({ where: { collegeId: iqac.collegeId }, orderBy: { startDate: 'asc' } }));
    const past = years.find((y) => y.status === 'locked') ?? years[0]!;
    const started = await reports.create(iqac, { templateId: aqar, academicYearId: past.id, outputs: ['index'] });
    const done = await finished(iqac, started.id);
    expect(done.label).toContain(past.label.replace('-', '–'));
    const rows = await sheetRows(await fileOf(iqac, done.id, 0), `C${metric.code.split('.')[0]}`);
    expect(rows.some((r) => r.includes('Workshop proof'))).toBe(false);
  });
});

describe('Who sees what', () => {
  it('limits a HOD to their departments and their own exports', async () => {
    const started = await reports.create(hod, { templateId: ssr, outputs: ['index'] });
    const done = await finished(hod, started.id);
    expect(done.status).toBe('done');
    const mine = await reports.list(hod);
    expect(mine.map((e) => e.id)).toEqual([done.id]);
    const all = await reports.list(iqac);
    expect(all.length).toBeGreaterThan(1);
    expect(await codeOf(reports.get(hod, all.find((e) => e.id !== done.id)!.id))).toBe('not_found');
  });

  it('shows another college nothing', async () => {
    expect(await reports.list(otherAdmin)).toEqual([]);
    const any = (await reports.list(iqac))[0]!;
    expect(await codeOf(reports.get(otherAdmin, any.id))).toBe('not_found');
    expect(await codeOf(reports.download(otherAdmin, any.id, 0))).toBe('not_found');
  });
});

describe('When something goes wrong', () => {
  it('marks the export failed, says so plainly, and leaves no files behind', async () => {
    const key = await prisma.forTenant(iqac.collegeId, (db) => db.evidence.findUniqueOrThrow({ where: { id: approvedId }, select: { fileKey: true } }));
    const saved = storage.files.get(key.fileKey)!;
    storage.files.delete(key.fileKey);
    const before = storage.files.size;
    const started = await reports.create(iqac, { templateId: ssr, outputs: ['index', 'pack'] });
    const done = await finished(iqac, started.id);
    storage.files.set(key.fileKey, saved);
    expect(done.status).toBe('failed');
    expect(done.error).toMatch(/Try again/);
    expect(done.files).toEqual([]);
    expect(storage.files.size).toBe(before + 1);
    expect(await codeOf(reports.download(iqac, done.id, 0))).toBe('not_found');
  });
});
