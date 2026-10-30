// Principal dashboard: what it counts, whose numbers a HOD sees, readiness "as of" a past date, and tenancy.

import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { createEvidenceSchema, reviewSchema, taskInputSchema } from '@yucampus/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccreditationService } from '../src/accreditation/accreditation.service.js';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { AppConfig } from '../src/config.js';
import { DashboardService } from '../src/dashboard/dashboard.service.js';
import { EvidenceService } from '../src/evidence/evidence.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { TasksService } from '../src/tasks/tasks.service.js';
import { MemoryStorage } from './memory-storage.js';
import { notificationsFor } from './notifications-for.js';
import { InProcessJobs } from '../src/jobs/jobs.js';

const PDF = new TextEncoder().encode('%PDF-1.4\n% dashboard evidence\n');

let database: Database;
let prisma: PrismaService;
let storage: MemoryStorage;
let accreditation: AccreditationService;
let dashboard: DashboardService;
let evidence: EvidenceService;
let tasks: TasksService;
let principal: AuthUser;
let iqac: AuthUser;
let hod: AuthUser;
let faculty: AuthUser;
let office: AuthUser;
let otherAdmin: AuthUser;
let metric: { id: string; documentKey: string };

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
  const ticket = await evidence.requestUpload(who, {
    fileName: 'Report.pdf',
    contentType: 'application/pdf',
    size: PDF.length,
    sha256: createHash('sha256').update(PDF).digest('hex'),
  });
  storage.put(ticket.url.replace('memory://', ''), PDF, 'application/pdf');
  return evidence.create(who, createEvidenceSchema.parse({ uploadToken: ticket.uploadToken, title, documentDate: '2026-08-20', ...link }));
}

const approve = (who: AuthUser, id: string) => evidence.review(who, id, reviewSchema.parse({ decision: 'approve' }) as never);
const missingNow = (at?: Date) =>
  prisma.forTenant(iqac.collegeId, async (db) => {
    const overview = await accreditation.computeOverview(db, iqac.collegeId, 'NAAC', undefined, at);
    return overview!.criteria.reduce((sum, c) => sum + c.missing, 0);
  });

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (owner) => {
      await seed(owner);
      const other = await owner.college.create({
        data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' },
      });
      await owner.academicYear.create({
        data: { collegeId: other.id, label: '2026-27', startDate: new Date('2026-07-01'), endDate: new Date('2027-06-30'), status: 'current' },
      });
      await owner.user.create({
        data: {
          collegeId: other.id,
          name: 'Other College Admin',
          email: 'admin@other-college.example',
          status: 'active',
          roles: { create: [{ collegeId: other.id, role: 'college_admin' }, { collegeId: other.id, role: 'principal' }] },
        },
      });
    },
  });
  prisma = new PrismaService(database);
  storage = new MemoryStorage();
  const permissions = new PermissionsService(prisma);
  accreditation = new AccreditationService(prisma);
  const notifications = notificationsFor(prisma);
  dashboard = new DashboardService(prisma, permissions, accreditation);
  evidence = new EvidenceService(prisma, storage, permissions, new AppConfig(), accreditation, notifications);
  tasks = new TasksService(prisma, permissions, notifications, accreditation, new InProcessJobs());
  principal = await actor('sample', 'principal@sample-college.example');
  iqac = await actor('sample', 'iqac@sample-college.example');
  hod = await actor('sample', 'hod.cse@sample-college.example');
  faculty = await actor('sample', 'faculty@sample-college.example');
  office = await actor('sample', 'office@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');

  await prisma.forTenant(iqac.collegeId, async (db) => {
    const active = await accreditation.activeFrameworkIds(db, iqac.collegeId);
    const metrics = await db.metric.findMany({ where: { criterion: { frameworkId: { in: active } } } });
    const withDocs = metrics.find((m) => Array.isArray(m.requiredDocuments) && m.requiredDocuments.length > 0)!;
    metric = { id: withDocs.id, documentKey: (withDocs.requiredDocuments as { key: string }[])[0]!.key };
  });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Principal dashboard', () => {
  it('starts empty but shows NAAC readiness, departments and the current year', async () => {
    const view = await dashboard.view(principal);
    expect(view.scope).toBe('college');
    expect(view.years.find((y) => y.id === view.academicYear.id)?.status).toBe('current');
    expect(view.naac?.frameworkName).toContain('NAAC');
    expect(view.naac?.change).toBeNull();
    expect(view.naac?.missingDocuments).toBeGreaterThan(0);
    expect(view.evidence).toEqual({ uploaded: 0, thisWeek: 0, approved: 0 });
    expect(view.review).toEqual({ pending: 0, oldestDays: null });
    expect(view.departments.map((d) => d.code)).toEqual(expect.arrayContaining(['CSE', 'ECE', 'MECH', 'MBA']));
    const cse = view.departments.find((d) => d.code === 'CSE')!;
    expect(cse.facultyYetToUpload).toBe(cse.faculty);
    expect(cse.tasksPercent).toBeNull();
    expect(view.deadlines.every((d, i, all) => d.daysLeft >= 0 && (i === 0 || all[i - 1]!.date <= d.date))).toBe(true);
  });

  it('counts uploads, pending reviews and tasks per department, and lists the activity', async () => {
    const first = await upload(faculty, 'FDP certificate', { metricId: metric.id, documentKey: metric.documentKey });
    await upload(faculty, 'Seminar report');
    await upload(office, 'Library stock register');
    await tasks.create(iqac, taskInputSchema.parse({ title: 'CSE newsletter', assignee: { kind: 'department', id: first.department!.id }, dueDate: '2026-12-01' }));

    const view = await dashboard.view(principal);
    expect(view.evidence).toEqual({ uploaded: 3, thisWeek: 3, approved: 0 });
    expect(view.review).toEqual({ pending: 3, oldestDays: 0 });
    const cse = view.departments.find((d) => d.code === 'CSE')!;
    expect(cse).toMatchObject({ uploaded: 2, inReview: 2, openTasks: 1, tasksPercent: 0 });
    expect(cse.facultyYetToUpload).toBe(cse.faculty - 1);
    expect(view.activity[0]?.text).toContain('assigned “CSE newsletter”');
    expect(view.activity.some((a) => a.kind === 'upload' && a.text.includes('(CSE) uploaded “FDP certificate”'))).toBe(true);
  });

  it('counts readiness from final approvals, and works out what it was 30 days ago', async () => {
    const before = await dashboard.view(principal);
    const item = (await dashboard.view(iqac)).activity.find((a) => a.text.includes('FDP certificate'))!;
    const id = item.link!.replace('/evidence/', '');
    await approve(hod, id);
    await approve(iqac, id);

    const after = await dashboard.view(principal);
    expect(after.evidence.approved).toBe(1);
    expect(after.review.pending).toBe(2);
    expect(after.naac!.missingDocuments).toBe(before.naac!.missingDocuments - 1);
    expect(after.naac!.change).not.toBeNull();
    expect(after.activity.some((a) => a.kind === 'approved' && a.text.includes('gave final approval to “FDP certificate”'))).toBe(true);

    // As of yesterday the approval had not happened; as of now it has.
    expect(await missingNow(new Date(Date.now() - 24 * 60 * 60 * 1000))).toBe(before.naac!.missingDocuments);
    expect(await missingNow(new Date())).toBe(after.naac!.missingDocuments);
  });

  it('gives a HOD the numbers of their own department only', async () => {
    const view = await dashboard.view(hod);
    expect(view.scope).toBe('department');
    expect(view.departments.map((d) => d.code)).toEqual(['CSE']);
    expect(view.programs.every((p) => p.departmentCode === 'CSE')).toBe(true);
    expect(view.evidence.uploaded).toBe(2); // The office's register has no department.
    expect(view.activity.some((a) => a.text.includes('Library stock register'))).toBe(false);
    expect(view.activity.some((a) => a.kind === 'task')).toBe(false);
  });

  it('is not for faculty or office staff', async () => {
    expect(await codeOf(dashboard.view(faculty))).toBe('forbidden');
    expect(await codeOf(dashboard.view(office))).toBe('forbidden');
  });

  it('shows another year, and refuses a year of another college', async () => {
    const otherYear = await prisma.forTenant(otherAdmin.collegeId, (db) => db.academicYear.findFirstOrThrow({ where: { collegeId: otherAdmin.collegeId } }));
    expect(await codeOf(dashboard.view(principal, otherYear.id))).toBe('not_found');
    const view = await dashboard.view(principal);
    const past = view.years.find((y) => y.id !== view.academicYear.id);
    if (past) expect((await dashboard.view(principal, past.id)).evidence.uploaded).toBe(0);
  });

  it('shows another college nothing of this one', async () => {
    const view = await dashboard.view(otherAdmin);
    expect(view.evidence.uploaded).toBe(0);
    expect(view.activity).toEqual([]);
    expect(view.departments).toEqual([]);
  });
});
