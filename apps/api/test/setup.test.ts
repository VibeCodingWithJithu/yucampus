// Institution setup, users and academic years, against the real migrations with row-level security on.
// All people and numbers here are dummy sample data.
import 'reflect-metadata';
import { HttpException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants.js';
import { SECTION_ACCESS } from '@yucampus/types';
import { userInputSchema } from '@yucampus/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { REQUIRED_ACCESS } from '../src/auth/decorators.js';
import { OtpSender } from '../src/auth/otp-sender.js';
import { hashPassword } from '../src/auth/passwords.js';
import { type AuthUser, TokensService } from '../src/auth/tokens.service.js';
import { AppConfig } from '../src/config.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { linksFor } from './notifications-for.js';
import { AcademicYearsService } from '../src/setup/academic-years.service.js';
import { DepartmentsService } from '../src/setup/departments.service.js';
import { InstitutionService } from '../src/setup/institution.service.js';
import { AcademicYearsController, DepartmentsController, InstitutionController } from '../src/setup/setup.controller.js';
import { UsersController } from '../src/users/users.controller.js';
import { UsersService } from '../src/users/users.service.js';

let database: Database;
let prisma: PrismaService;
let departments: DepartmentsService;
let users: UsersService;
let years: AcademicYearsService;
let institution: InstitutionService;
let permissions: PermissionsService;

let admin: AuthUser;
let iqac: AuthUser;
let otherAdmin: AuthUser;
let otherDepartmentId: string;
let otherUserId: string;
let otherYearId: string;

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

const person = (input: Parameters<typeof userInputSchema.parse>[0]) => userInputSchema.parse(input);

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (owner) => {
      await seed(owner);
      const other = await owner.college.create({
        data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' },
      });
      const department = await owner.department.create({ data: { collegeId: other.id, name: 'Pharmacy', code: 'PHARM' } });
      const user = await owner.user.create({
        data: {
          collegeId: other.id,
          name: 'Other College Admin',
          email: 'admin@other-college.example',
          passwordHash: await hashPassword('Other@12345'),
          status: 'active',
          roles: { create: [{ collegeId: other.id, role: 'college_admin' }] },
        },
      });
      const year = await owner.academicYear.create({
        data: { collegeId: other.id, label: '2026-27', startDate: new Date('2026-07-01'), endDate: new Date('2027-06-30'), status: 'current' },
      });
      otherDepartmentId = department.id;
      otherUserId = user.id;
      otherYearId = year.id;
    },
  });
  prisma = new PrismaService(database);
  departments = new DepartmentsService(prisma);
  permissions = new PermissionsService(prisma);
  users = new UsersService(prisma, permissions, linksFor(prisma).links);
  years = new AcademicYearsService(prisma);
  institution = new InstitutionService(prisma, new AppConfig());
  admin = await actor('sample', 'admin@sample-college.example');
  iqac = await actor('sample', 'iqac@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');
}, 120_000);

afterAll(() => database.close());

describe('route permissions', () => {
  const controllers = [InstitutionController, DepartmentsController, AcademicYearsController, UsersController];

  it('protects every route that changes data with "Manage users and setup"', () => {
    let checked = 0;
    for (const controller of controllers) {
      const classRoles = Reflect.getMetadata(REQUIRED_ACCESS, controller);
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as unknown as Record<string, object>)[name]!;
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined || method === RequestMethod.GET) continue;
        const roles = Reflect.getMetadata(REQUIRED_ACCESS, handler) ?? classRoles;
        expect([SECTION_ACCESS.setup, SECTION_ACCESS.users], `${controller.name}.${name}`).toContain(roles);
        checked++;
      }
    }
    // 16 from slice 2, plus adding a cycle, setting a program's framework, resending an invite and the SSO settings.
    expect(checked).toBe(20);
  });

  it('keeps the people list to the users section', () => {
    expect(Reflect.getMetadata(REQUIRED_ACCESS, UsersController)).toBe(SECTION_ACCESS.users);
  });
});

describe('departments', () => {
  it('adds a department with programs and refuses a code already in use', async () => {
    const created = await departments.create(admin, {
      name: 'Civil Engineering',
      code: 'CIVIL',
      programs: [{ name: 'B.Tech Civil Engineering', level: 'UG' }],
    });
    expect(created).toMatchObject({ code: 'CIVIL', hod: null, facultyCount: 0 });
    expect(created.programs.map((program) => program.name)).toEqual(['B.Tech Civil Engineering']);
    expect(await codeOf(departments.create(admin, { name: 'Again', code: 'CIVIL' }))).toBe('department_code_taken');
  });

  it('lists only this college and shows head and faculty count', async () => {
    const list = await departments.list(admin);
    expect(list.map((department) => department.code)).not.toContain('PHARM');
    const cse = list.find((department) => department.code === 'CSE')!;
    expect(cse.hod?.name).toBe('Sample HOD (CSE)');
    expect(cse.facultyCount).toBe(2);
  });

  it('moves the head of department, and refuses a person from another college', async () => {
    const civil = (await departments.list(admin)).find((department) => department.code === 'CIVIL')!;
    const faculty = await actor('sample', 'faculty@sample-college.example');

    expect(await codeOf(departments.update(admin, civil.id, { name: civil.name, code: 'CIVIL', hodUserId: otherUserId }))).toBe(
      'not_found',
    );
    const updated = await departments.update(admin, civil.id, { name: civil.name, code: 'CIVIL', hodUserId: faculty.id });
    expect(updated.hod?.id).toBe(faculty.id);
    const cleared = await departments.update(admin, civil.id, { name: civil.name, code: 'CIVIL', hodUserId: null });
    expect(cleared.hod).toBeNull();
  });

  it('cannot touch another college’s department or program', async () => {
    expect(await codeOf(departments.update(admin, otherDepartmentId, { name: 'X', code: 'XX', hodUserId: null }))).toBe('not_found');
    expect(await codeOf(departments.remove(admin, otherDepartmentId))).toBe('not_found');
    expect(await codeOf(departments.addProgram(admin, otherDepartmentId, { name: 'B.Pharm', level: 'UG' }))).toBe('not_found');
  });

  it('removes only an empty department', async () => {
    const cse = (await departments.list(admin)).find((department) => department.code === 'CSE')!;
    expect(await codeOf(departments.remove(admin, cse.id))).toBe('department_in_use');
    const empty = await departments.create(admin, { name: 'To remove', code: 'TMP' });
    await departments.remove(admin, empty.id);
    expect((await departments.list(admin)).map((department) => department.code)).not.toContain('TMP');
  });
});

describe('users', () => {
  it('keeps IQAC out of user management until the principal grants it', async () => {
    expect(await codeOf(users.list(iqac, { page: 1, pageSize: 20 }))).toBe('forbidden');
    const principal = await actor('sample', 'principal@sample-college.example');
    await permissions.update(principal, { role: 'iqac', permission: 'users_setup.manage', allowed: true });
    expect((await users.list(iqac, { page: 1, pageSize: 20 })).total).toBeGreaterThan(0);
  });

  it('lists only this college, with search, role filter, pages and counts', async () => {
    const all = await users.list(admin, { page: 1, pageSize: 20 });
    expect(all.items.every((user) => user.email?.endsWith('@sample-college.example'))).toBe(true);
    expect(all.counts.total).toBe(all.total);

    const found = await users.list(admin, { page: 1, pageSize: 20, search: 'iqac' });
    expect(found.items.map((user) => user.name)).toEqual(['Sample IQAC Coordinator']);
    const byMobile = await users.list(admin, { page: 1, pageSize: 20, search: '90000 00007' });
    expect(byMobile.items.map((user) => user.name)).toEqual(['Sample Faculty']);
    const faculty = await users.list(admin, { page: 1, pageSize: 20, role: 'faculty' });
    expect(faculty.items.map((user) => user.name).sort()).toEqual(['Sample Faculty', 'Sample HOD (CSE)', 'Sample NBA Coordinator']);

    const cse = (await departments.list(admin)).find((department) => department.code === 'CSE')!;
    const inCse = await users.list(admin, { page: 1, pageSize: 20, departmentId: cse.id });
    expect(inCse.items.map((user) => user.name).sort()).toEqual(['Sample Faculty', 'Sample HOD (CSE)']);

    const page2 = await users.list(admin, { page: 2, pageSize: 3 });
    expect(page2.items).toHaveLength(3);
    expect(page2.items[0]!.name).not.toBe((await users.list(admin, { page: 1, pageSize: 3 })).items[0]!.name);
  });

  it('invites a person who can then sign in with a mobile code and becomes active', async () => {
    const cse = (await departments.list(admin)).find((department) => department.code === 'CSE')!;
    const invited = await users.create(
      iqac,
      person({ name: 'Sample New Faculty', mobile: '9000000020', roles: [{ role: 'faculty', departmentId: cse.id }] }),
    );
    expect(invited.status).toBe('invited');
    expect(invited.roles).toEqual([{ role: 'faculty', departmentId: cse.id, departmentCode: 'CSE' }]);

    const sent: string[] = [];
    const sender = new (class extends OtpSender {
      async send(_mobile: string, code: string) {
        sent.push(code);
      }
    })();
    const config = new AppConfig();
    const auth = new AuthService(prisma, new TokensService(config), sender, config, permissions, linksFor(prisma, config).links);
    await auth.requestOtp('sample', '9000000020');
    const { session } = await auth.verifyOtp('sample', '9000000020', sent[0]!);
    expect(session.user.status).toBe('active');
  });

  it('refuses an email or mobile someone in the college already uses', async () => {
    const taken = person({ name: 'Copy', email: 'faculty@sample-college.example', roles: [{ role: 'office' }] });
    expect(await codeOf(users.create(admin, taken))).toBe('contact_taken');
  });

  it('allows the same email in a different college', async () => {
    const created = await users.create(otherAdmin, person({ name: 'Shared Email', email: 'faculty@sample-college.example', roles: [{ role: 'office' }] }));
    expect(created.status).toBe('invited');
  });

  it('refuses a department from another college', async () => {
    const input = person({ name: 'Sneaky', email: 'sneaky@sample-college.example', roles: [{ role: 'faculty', departmentId: otherDepartmentId }] });
    expect(await codeOf(users.create(admin, input))).toBe('not_found');
  });

  it('refuses a second head for a department', async () => {
    const cse = (await departments.list(admin)).find((department) => department.code === 'CSE')!;
    const input = person({ name: 'Second HOD', email: 'hod2@sample-college.example', roles: [{ role: 'hod', departmentId: cse.id }] });
    expect(await codeOf(users.create(admin, input))).toBe('department_has_hod');
  });

  it('lets only a college admin give or edit the college admin role', async () => {
    const newAdmin = person({ name: 'Sample Second Admin', email: 'admin2@sample-college.example', roles: [{ role: 'college_admin' }] });
    expect(await codeOf(users.create(iqac, newAdmin))).toBe('admin_only');
    const created = await users.create(admin, newAdmin);

    const rename = person({ name: 'Renamed', email: 'mine@sample-college.example', roles: [{ role: 'college_admin' }] });
    expect(await codeOf(users.update(iqac, created.id, rename))).toBe('admin_only');
    const demote = person({ name: 'Sample Second Admin', email: 'admin2@sample-college.example', roles: [{ role: 'iqac' }] });
    expect(await codeOf(users.update(iqac, created.id, demote))).toBe('admin_only');
    expect((await users.update(admin, created.id, demote)).roles.map((r) => r.role)).toEqual(['iqac']);
  });

  it('does not let an admin remove their own admin role', async () => {
    const self = person({ name: 'Sample College Admin', email: 'admin@sample-college.example', mobile: '9000000001', roles: [{ role: 'iqac' }] });
    expect(await codeOf(users.update(admin, admin.id, self))).toBe('cannot_remove_own_admin');
  });

  it('cannot read or edit a person in another college', async () => {
    expect(await codeOf(users.get(admin, otherUserId))).toBe('not_found');
    expect(await codeOf(users.update(admin, otherUserId, person({ name: 'X', email: 'x@example.test', roles: [{ role: 'office' }] })))).toBe(
      'not_found',
    );
  });

  it('records changes in the audit log', async () => {
    const entries = await prisma.forTenant(admin.collegeId, (db) =>
      db.auditLog.findMany({ where: { collegeId: admin.collegeId, entity: 'user', action: 'invite' } }),
    );
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.userId)).toBe(true);
  });
});

describe('importing people from a spreadsheet', () => {
  const rows = [
    { name: 'Sample Import One', email: 'one@sample-college.example', role: 'Faculty', departmentCode: 'ece' },
    { name: 'Sample Import One', email: 'one@sample-college.example', role: 'NBA coordinator', departmentCode: '' },
    { name: 'Sample Import Two', mobile: 9000000031, role: 'Office' },
    { name: 'Already Here', email: 'iqac@sample-college.example', role: 'IQAC' },
  ];

  it('checks rows without saving, and reports problems by spreadsheet row', async () => {
    const result = await users.import(admin, [...rows, { name: 'Bad', email: 'bad@sample-college.example', role: 'Faculty', departmentCode: 'XYZ' }, { name: '', role: 'Wizard' }], true);
    expect(result.saved).toBe(false);
    expect(result.skipped).toBe(1);
    expect(result.problems.map((problem) => problem.row)).toEqual([6, 7]);
    expect(result.problems[0]!.message).toContain('XYZ');
  });

  it('saves nothing when any row has a problem', async () => {
    const before = (await users.list(admin, { page: 1, pageSize: 20 })).total;
    const result = await users.import(admin, [...rows, { name: 'Bad', role: 'Faculty', email: 'b@sample-college.example' }], false);
    expect(result.saved).toBe(false);
    expect((await users.list(admin, { page: 1, pageSize: 20 })).total).toBe(before);
  });

  it('adds new people, merging rows for the same person into several roles', async () => {
    const result = await users.import(admin, rows, false);
    expect(result).toMatchObject({ saved: true, created: 2, skipped: 1, problems: [] });
    const one = (await users.list(admin, { page: 1, pageSize: 20, search: 'one@sample' })).items[0]!;
    expect(one.status).toBe('invited');
    expect(one.roles.map((role) => role.role).sort()).toEqual(['faculty', 'nba_coord']);
  });

  it('does not let a non-admin import a college admin', async () => {
    const result = await users.import(iqac, [{ name: 'X', email: 'x2@sample-college.example', role: 'College admin' }], true);
    expect(result.problems[0]!.message).toContain('college admin');
  });
});

describe('academic years', () => {
  it('lists this college’s years, newest first, with semesters and key dates', async () => {
    const list = await years.list(admin);
    expect(list.map((year) => `${year.label}:${year.status}`)).toEqual(['2027-28:next', '2026-27:current', '2025-26:locked']);
    const current = list[1]!;
    expect(current.terms.map((term) => term.name)).toEqual(['Odd semester', 'Even semester']);
    expect(current.keyDates.length).toBeGreaterThan(0);
  });

  it('refuses changes to a locked year and to another college’s year', async () => {
    const lockedYear = (await years.list(admin)).find((year) => year.status === 'locked')!;
    const dates = { startDate: '2025-07-01', endDate: '2026-06-30', terms: [] };
    expect(await codeOf(years.updateDates(admin, lockedYear.id, dates))).toBe('year_locked');
    expect(await codeOf(years.addKeyDate(admin, lockedYear.id, { title: 'X', date: '2026-01-01', remindDaysBefore: 1 }))).toBe('year_locked');
    expect(await codeOf(years.updateDates(admin, otherYearId, dates))).toBe('not_found');
    expect(await codeOf(years.addKeyDate(admin, otherYearId, { title: 'X', date: '2026-01-01', remindDaysBefore: 1 }))).toBe('not_found');
  });

  it('adds, changes and removes key dates', async () => {
    const current = (await years.list(admin)).find((year) => year.status === 'current')!;
    const added = await years.addKeyDate(admin, current.id, { title: 'NBA SAR · B.Tech CSE', date: '2027-01-30', remindDaysBefore: 14 });
    expect(added).toMatchObject({ date: '2027-01-30', remindDaysBefore: 14 });
    const changed = await years.updateKeyDate(admin, added.id, { title: 'NBA SAR', date: '2027-02-15', remindDaysBefore: 30 });
    expect(changed).toMatchObject({ title: 'NBA SAR', date: '2027-02-15', remindDaysBefore: 30 });
    await years.removeKeyDate(admin, added.id);
    expect(await codeOf(years.removeKeyDate(admin, added.id))).toBe('not_found');
  });

  it('starts the next year: current locks, next becomes current, the year after is prepared', async () => {
    const result = await years.startNextYear(admin);
    expect(result.map((year) => `${year.label}:${year.status}`)).toEqual([
      '2028-29:next',
      '2027-28:current',
      '2026-27:locked',
      '2025-26:locked',
    ]);
    const prepared = result[0]!;
    expect(prepared).toMatchObject({ startDate: '2028-07-01', endDate: '2029-06-30' });
    expect(prepared.terms[0]).toEqual({ name: 'Odd semester', start: '2028-07-01', end: '2028-12-31' });
    // Key dates stay with the year they belong to.
    expect(result[2]!.keyDates.length).toBeGreaterThan(0);
  });
});

describe('institution profile, frameworks and progress', () => {
  it('saves the profile, keeps the subdomain, and marks the step done', async () => {
    const before = await institution.progress(admin);
    expect(before.find((step) => step.key === 'profile')!.state).not.toBe('done');

    const saved = await institution.updateProfile(admin, {
      name: 'Sri Example Institute of Engineering',
      type: 'affiliated',
      state: 'Andhra Pradesh',
      city: 'Sample City',
      aisheCode: 'C-00000',
      affiliatingUniversity: 'Sample University',
      establishedYear: 2001,
      approvalLevels: 1,
    });
    expect(saved).toMatchObject({ subdomain: 'sample', aisheCode: 'C-00000', establishedYear: 2001, approvalLevels: 1 });
    const after = await institution.progress(admin);
    expect(after.find((step) => step.key === 'profile')!.state).toBe('done');
    expect(after.find((step) => step.key === 'templates')!.state).toBe('later');
    expect(after.filter((step) => step.state === 'current').length).toBeLessThanOrEqual(1);
  });

  it('keeps NAAC to one active framework per cycle, and keeps the switched-off one', async () => {
    const view = await institution.listFrameworks(admin);
    const raf = view.options.find((option) => option.code === 'NAAC_RAF_AFFILIATED')!;
    const binary = view.options.find((option) => option.code === 'NAAC_BINARY_MBGL')!;
    // The sample college is affiliated and works against the template extracted from the affiliated manual.
    expect(raf.criteriaCount).toBe(7);
    const cycle = view.cycles.find((c) => c.body === 'NAAC')!;
    expect(view.college).toContainEqual({ frameworkId: raf.id, cycleId: cycle.id, active: true });

    const both = { body: 'NAAC' as const, cycleId: cycle.id, frameworkIds: [raf.id, binary.id] };
    expect(await codeOf(institution.setCollegeFrameworks(admin, both))).toBe('one_framework_only');

    const switched = await institution.setCollegeFrameworks(admin, { body: 'NAAC', cycleId: cycle.id, frameworkIds: [binary.id] });
    expect(switched.college).toContainEqual({ frameworkId: binary.id, cycleId: cycle.id, active: true });
    expect(switched.college).toContainEqual({ frameworkId: raf.id, cycleId: cycle.id, active: false });

    // A new cycle can use a different framework.
    const withCycle = await institution.addCycle(admin, { body: 'NAAC', label: 'Cycle 3', startDate: '2029-07-01', endDate: '2034-06-30' });
    const next = withCycle.cycles.find((c) => c.label === 'Cycle 3')!;
    await institution.setCollegeFrameworks(admin, { body: 'NAAC', cycleId: next.id, frameworkIds: [raf.id] });
    const after = await institution.listFrameworks(admin);
    // Two active NAAC rows (one per cycle); the sample college also applies in NIRF Engineering.
    const naacIds = new Set(view.options.filter((o) => o.body === 'NAAC').map((o) => o.id));
    expect(after.college.filter((row) => row.active && naacIds.has(row.frameworkId)).length).toBe(2);
    expect(await codeOf(institution.addCycle(admin, { body: 'NAAC', label: 'Cycle 3' }))).toBe('cycle_exists');
  });

  it('lets a college take part in several NIRF categories', async () => {
    const view = await institution.listFrameworks(admin);
    const nirf = view.options.filter((option) => option.body === 'NIRF');
    expect(nirf.every((option) => option.selection === 'multiple')).toBe(true);
    const ids = nirf.slice(0, 3).map((option) => option.id);
    const saved = await institution.setCollegeFrameworks(admin, { body: 'NIRF', cycleId: null, frameworkIds: ids });
    expect(saved.college.filter((row) => row.active && ids.includes(row.frameworkId)).length).toBe(3);
  });

  it('refuses frameworks of another body, program-level frameworks at college level, and other colleges’ cycles', async () => {
    const view = await institution.listFrameworks(admin);
    const nba = view.options.find((option) => option.body === 'NBA')!;
    const raf = view.options.find((option) => option.code === 'NAAC_RAF_AFFILIATED')!;
    expect(nba.attachesTo).toBe('program');
    expect(await codeOf(institution.setCollegeFrameworks(admin, { body: 'NBA', cycleId: null, frameworkIds: [nba.id] }))).toBe('invalid_input');
    expect(await codeOf(institution.setCollegeFrameworks(admin, { body: 'NIRF', cycleId: null, frameworkIds: [raf.id] }))).toBe('invalid_input');
    const cycle = view.cycles.find((c) => c.body === 'NAAC')!;
    expect(await codeOf(institution.setCollegeFrameworks(otherAdmin, { body: 'NAAC', cycleId: cycle.id, frameworkIds: [raf.id] }))).toBe(
      'not_found',
    );
    expect((await institution.listFrameworks(otherAdmin)).college).toEqual([]);
  });

  it('attaches NBA per program, keeping the previous framework when it changes', async () => {
    const view = await institution.listFrameworks(admin);
    const tier1 = view.options.find((option) => option.code === 'NBA_ENGG_TIER1')!;
    const raf = view.options.find((option) => option.code === 'NAAC_RAF_AFFILIATED')!;
    const cse = (await departments.list(admin)).find((department) => department.code === 'CSE')!;
    const program = cse.programs[0]!;
    expect(program.framework?.code).toBe('NBA_ENGG_TIER2');

    expect((await departments.setProgramFramework(admin, program.id, { frameworkId: tier1.id })).framework?.code).toBe('NBA_ENGG_TIER1');
    expect(await codeOf(departments.setProgramFramework(admin, program.id, { frameworkId: raf.id }))).toBe('invalid_input');
    expect((await departments.setProgramFramework(admin, program.id, { frameworkId: null })).framework).toBeNull();
    const rows = await prisma.forTenant(admin.collegeId, (db) => db.programFramework.findMany({ where: { programId: program.id } }));
    expect(rows.length).toBe(2);
    expect(rows.every((row) => !row.active)).toBe(true);
  });
});
