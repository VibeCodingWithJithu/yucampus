// Permission templates, college adjustments, and the HOD's department-only user management.
// Runs against the real migrations with row-level security on. All data is dummy sample data.
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { can } from '@yucampus/types';
import { userInputSchema } from '@yucampus/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { linksFor } from './notifications-for.js';
import { DepartmentsService } from '../src/setup/departments.service.js';
import { UsersService } from '../src/users/users.service.js';

let database: Database;
let prisma: PrismaService;
let permissions: PermissionsService;
let users: UsersService;
let admin: AuthUser;
let principal: AuthUser;
let iqac: AuthUser;
let hod: AuthUser;
let otherAdmin: AuthUser;
let cseId: string;
let eceId: string;

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

const grantsOf = (person: AuthUser) => permissions.grantsFor(person.collegeId, person.roles);

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
  permissions = new PermissionsService(prisma);
  users = new UsersService(prisma, permissions, linksFor(prisma).links);
  admin = await actor('sample', 'admin@sample-college.example');
  principal = await actor('sample', 'principal@sample-college.example');
  iqac = await actor('sample', 'iqac@sample-college.example');
  hod = await actor('sample', 'hod.cse@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');
  const departments = await new DepartmentsService(prisma).list(admin);
  cseId = departments.find((department) => department.code === 'CSE')!.id;
  eceId = departments.find((department) => department.code === 'ECE')!.id;
}, 120_000);

afterAll(() => database.close());

describe('who may change permissions', () => {
  it('lets the college admin change every entry except the locked ones', async () => {
    const cells = await permissions.matrix(admin);
    expect(cells.filter((cell) => cell.locked).every((cell) => !cell.editable)).toBe(true);
    expect(cells.filter((cell) => !cell.locked).every((cell) => cell.editable)).toBe(true);
    const locked = { role: 'college_admin' as const, permission: 'users_setup.manage' as const, allowed: false };
    expect(await codeOf(permissions.update(admin, locked))).toBe('permission_locked');
  });

  it('lets the principal change only IQAC’s "Manage users and setup"', async () => {
    const editable = (await permissions.matrix(principal)).filter((cell) => cell.editable);
    expect(editable.map((cell) => `${cell.role}:${cell.permission}`)).toEqual(['iqac:users_setup.manage']);
    expect(await codeOf(permissions.update(principal, { role: 'hod', permission: 'reports.generate', allowed: false }))).toBe('forbidden');

    expect(can(await grantsOf(iqac), 'users_setup.manage')).toBe(false);
    await permissions.update(principal, { role: 'iqac', permission: 'users_setup.manage', allowed: true });
    expect(can(await grantsOf(iqac), 'users_setup.manage', ['college'])).toBe(true);
    await permissions.update(principal, { role: 'iqac', permission: 'users_setup.manage', allowed: false });
    expect(can(await grantsOf(iqac), 'users_setup.manage')).toBe(false);
  });

  it('does not let IQAC, HODs or faculty change permissions', async () => {
    for (const person of [iqac, hod]) {
      expect(await codeOf(permissions.update(person, { role: 'faculty', permission: 'dashboards.view', allowed: false }))).toBe('forbidden');
    }
  });

  it('refuses a permission the role’s template does not have', async () => {
    expect(await codeOf(permissions.update(admin, { role: 'faculty', permission: 'users_setup.manage', allowed: true }))).toBe('invalid_input');
  });
});

describe('college adjustments', () => {
  it('applies at once, stores only differences from the default, and is audit-logged', async () => {
    await permissions.update(admin, { role: 'principal', permission: 'evidence.upload', allowed: true });
    expect(can(await grantsOf(principal), 'evidence.upload')).toBe(true);
    const cell = (await permissions.matrix(admin)).find((c) => c.role === 'principal' && c.permission === 'evidence.upload')!;
    expect(cell).toMatchObject({ allowed: true, defaultOn: false, adjusted: true });

    await permissions.update(admin, { role: 'principal', permission: 'evidence.upload', allowed: false });
    const rows = await prisma.forTenant(admin.collegeId, (db) =>
      db.collegeRolePermission.count({ where: { collegeId: admin.collegeId, role: 'principal', permission: 'evidence.upload' } }),
    );
    expect(rows).toBe(0);
    const audits = await prisma.forTenant(admin.collegeId, (db) =>
      db.auditLog.count({ where: { collegeId: admin.collegeId, entity: 'permission', entityId: 'principal:evidence.upload' } }),
    );
    expect(audits).toBe(2);
  });

  it('never reaches another college', async () => {
    await permissions.update(admin, { role: 'hod', permission: 'reports.generate', allowed: false });
    const otherCell = (await permissions.matrix(otherAdmin)).find((c) => c.role === 'hod' && c.permission === 'reports.generate')!;
    expect(otherCell.allowed).toBe(true);
    await permissions.update(admin, { role: 'hod', permission: 'reports.generate', allowed: true });
  });
});

describe('a HOD manages faculty of their own department only', () => {
  const faculty = (name: string, email: string, departmentId: string) =>
    userInputSchema.parse({ name, email, roles: [{ role: 'faculty', departmentId }] });

  it('sees only people of their department', async () => {
    const list = await users.list(hod, { page: 1, pageSize: 20 });
    expect(list.items.map((user) => user.name).sort()).toEqual(['Sample Faculty', 'Sample HOD (CSE)']);
    expect(list.counts.total).toBe(2);
    const office = await actor('sample', 'office@sample-college.example');
    expect(await codeOf(users.get(hod, office.id))).toBe('not_found');
  });

  it('adds and edits faculty of their department', async () => {
    const added = await users.create(hod, faculty('Sample CSE Teacher', 'cse.teacher@sample-college.example', cseId));
    expect(added.roles).toEqual([{ role: 'faculty', departmentId: cseId, departmentCode: 'CSE' }]);
    const renamed = await users.update(hod, added.id, faculty('Sample CSE Teacher (renamed)', 'cse.teacher@sample-college.example', cseId));
    expect(renamed.name).toBe('Sample CSE Teacher (renamed)');
  });

  it('cannot add people to another department or give other roles', async () => {
    expect(await codeOf(users.create(hod, faculty('X', 'x@sample-college.example', eceId)))).toBe('department_only');
    const asIqac = userInputSchema.parse({ name: 'Y', email: 'y@sample-college.example', roles: [{ role: 'iqac' }] });
    expect(await codeOf(users.create(hod, asIqac))).toBe('department_only');
  });

  it('cannot edit people who hold more than a faculty role, including themselves', async () => {
    const self = userInputSchema.parse({ name: 'Me', email: 'hod.cse@sample-college.example', roles: [{ role: 'faculty', departmentId: cseId }] });
    expect(await codeOf(users.update(hod, hod.id, self))).toBe('department_only');
  });

  it('can import only faculty of their department', async () => {
    const result = await users.import(
      hod,
      [
        { name: 'Sample Import CSE', email: 'imp.cse@sample-college.example', role: 'Faculty', departmentCode: 'CSE' },
        { name: 'Sample Import ECE', email: 'imp.ece@sample-college.example', role: 'Faculty', departmentCode: 'ECE' },
        { name: 'Sample Import Office', email: 'imp.office@sample-college.example', role: 'Office' },
      ],
      true,
    );
    expect(result.problems.map((problem) => problem.row)).toEqual([3, 4]);
  });

  it('loses all of this when the college switches it off for HODs', async () => {
    await permissions.update(admin, { role: 'hod', permission: 'users_setup.manage', allowed: false });
    expect(await codeOf(users.list(hod, { page: 1, pageSize: 20 }))).toBe('forbidden');
    await permissions.update(admin, { role: 'hod', permission: 'users_setup.manage', allowed: true });
  });
});
