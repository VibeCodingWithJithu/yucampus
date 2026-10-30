// The college's audit log page: who may read it, filters (person, kind, India dates), the before/after changes with
// secrets hidden, entries by YuCampus support, the CSV download and its limit, and isolation between colleges.

import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogService, changesOf } from '../src/audit-log/audit-log.service.js';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { RegistersService } from '../src/registers/registers.service.js';

let database: Database;
let prisma: PrismaService;
let auditLog: AuditLogService;
let admin: AuthUser;
let principal: AuthUser;
let iqac: AuthUser;
let hod: AuthUser;
let faculty: AuthUser;
let otherAdmin: AuthUser;

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

const query = (extra: Record<string, unknown> = {}) => ({ page: 1, pageSize: 30, ...extra }) as Parameters<AuditLogService['list']>[1];

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (owner) => {
      await seed(owner);
      const other = await owner.college.create({ data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' } });
      await owner.user.create({
        data: { collegeId: other.id, name: 'Other College Admin', email: 'admin@other-college.example', status: 'active', roles: { create: [{ collegeId: other.id, role: 'college_admin' }] } },
      });
    },
  });
  prisma = new PrismaService(database);
  const permissions = new PermissionsService(prisma);
  auditLog = new AuditLogService(prisma, permissions);
  admin = await actor('sample', 'admin@sample-college.example');
  principal = await actor('sample', 'principal@sample-college.example');
  iqac = await actor('sample', 'iqac@sample-college.example');
  hod = await actor('sample', 'hod.cse@sample-college.example');
  faculty = await actor('sample', 'faculty@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');

  // Something real: IQAC enters this year's college figures.
  const year = await prisma.forTenant(iqac.collegeId, (db) => db.academicYear.findFirstOrThrow({ where: { collegeId: iqac.collegeId, status: 'current' } }));
  await new RegistersService(prisma, permissions).create(iqac, 'COLLEGE_FIGURES', {
    academicYearId: year.id,
    data: { source: 'Office records', studentsOnRoll: 1200, sanctionedTeachingPosts: 80, expenditureExSalaryLakh: 250, studentComputers: 300 },
  });
  // And entries with known times: 18 Oct 00:30 India time is 17 Oct 19:00 UTC.
  await prisma.forTenant(admin.collegeId, async (db) => {
    await db.auditLog.create({
      data: {
        collegeId: admin.collegeId,
        userId: admin.id,
        entity: 'user',
        entityId: faculty.id,
        action: 'update',
        before: { name: 'Sample Faculty', passwordHash: 'abc' },
        after: { name: '=Sample Faculty', passwordHash: 'def' },
        at: new Date('2026-10-17T19:00:00Z'),
      },
    });
    await db.auditLog.create({
      data: { collegeId: admin.collegeId, entity: 'college', entityId: admin.collegeId, action: 'platform_suspend', after: { by: 'YuCampus support', status: 'suspended' }, at: new Date('2026-10-16T06:00:00Z') },
    });
  });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Who reads the audit log', () => {
  it('is the college admin and the principal', async () => {
    expect((await auditLog.list(admin, query())).total).toBeGreaterThan(0);
    expect((await auditLog.list(principal, query())).total).toBeGreaterThan(0);
    for (const person of [iqac, hod, faculty]) expect(await codeOf(auditLog.list(person, query()))).toBe('forbidden');
  });

  it('shows another college nothing of this one', async () => {
    const page = await auditLog.list(otherAdmin, query());
    expect(page.total).toBe(0);
    expect(page.people).toEqual([]);
  });
});

describe('What it shows', () => {
  it('lists entries newest first with who, what and the changes', async () => {
    const page = await auditLog.list(admin, query());
    const times = page.items.map((i) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
    const record = page.items.find((i) => i.entity === 'register_record')!;
    expect(record).toMatchObject({ actor: 'person', who: { id: iqac.id, name: 'Sample IQAC Coordinator' }, entityLabel: 'Register record', actionLabel: 'Created' });
    expect(page.people.map((p) => p.name)).toEqual(expect.arrayContaining(['Sample College Admin', 'Sample IQAC Coordinator']));
    expect(page.entities.map((e) => e.label)).toEqual(expect.arrayContaining(['College', 'Person', 'Register record']));
  });

  it('hides secrets and marks YuCampus support', async () => {
    const page = await auditLog.list(admin, query({ entity: 'user', userId: admin.id }));
    const change = page.items.find((i) => i.action === 'update')!;
    expect(change.changes).toEqual([
      { field: 'name', before: 'Sample Faculty', after: '=Sample Faculty' },
      { field: 'passwordHash', before: 'hidden', after: 'hidden' },
    ]);
    const support = (await auditLog.list(admin, query({ entity: 'college' }))).items.find((i) => i.action === 'platform_suspend')!;
    expect(support).toMatchObject({ actor: 'support', who: null, actionLabel: 'Suspended by YuCampus', changes: [{ field: 'status', before: null, after: 'suspended' }] });
  });

  it('filters by India dates, both ends included', async () => {
    const on18 = await auditLog.list(admin, query({ entity: 'user', from: '2026-10-18', to: '2026-10-18' }));
    expect(on18.items.some((i) => i.action === 'update')).toBe(true);
    const on17 = await auditLog.list(admin, query({ entity: 'user', from: '2026-10-17', to: '2026-10-17' }));
    expect(on17.items.some((i) => i.action === 'update')).toBe(false);
  });

  it('pages', async () => {
    const first = await auditLog.list(admin, query({ pageSize: 1 }));
    const second = await auditLog.list(admin, query({ pageSize: 1, page: 2 }));
    expect(first.items).toHaveLength(1);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
  });

  it('compares plain values too', () => {
    expect(changesOf(null, { approved: true, note: '' })).toEqual([{ field: 'approved', before: null, after: 'Yes' }]);
    expect(changesOf('a', 'b')).toEqual([{ field: 'value', before: 'a', after: 'b' }]);
  });
});

describe('CSV download', () => {
  it('has a heading row, India times and no spreadsheet formulas', async () => {
    const file = await auditLog.csv(admin, query({ entity: 'user', from: '2026-10-18', to: '2026-10-18' }));
    expect(file.name).toBe('Audit log 2026-10-18 to 2026-10-18.csv');
    const text = file.body.toString('utf8');
    expect(text.startsWith('﻿When (India time),Who,Record,Record id,Action,Changes\r\n')).toBe(true);
    expect(text).toContain('2026-10-18 00:30,Sample College Admin,Person,');
    expect(text).toContain('name: Sample Faculty → =Sample Faculty; passwordHash: hidden → hidden');
    expect(text).not.toMatch(/,=Sample/);
  });

  it('refuses more than 5,000 rows instead of cutting silently', async () => {
    await prisma.forTenant(otherAdmin.collegeId, (db) =>
      db.auditLog.createMany({
        data: Array.from({ length: 5001 }, (_, i) => ({ collegeId: otherAdmin.collegeId, userId: otherAdmin.id, entity: 'task', entityId: String(i), action: 'create' })),
      }),
    );
    expect(await codeOf(auditLog.csv(otherAdmin, query()))).toBe('too_many');
    expect((await auditLog.csv(otherAdmin, query({ from: '2020-01-01', to: '2020-01-02' }))).body.toString('utf8').split('\r\n')).toHaveLength(2);
  });
});
