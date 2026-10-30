import { describe, expect, it } from 'vitest';
import { ROLES, type Role } from './index.js';
import {
  type Grant,
  PERMISSIONS,
  ROLE_TEMPLATES,
  SECTIONS,
  can,
  canOpenSection,
  departmentsFor,
  effectiveGrants,
  hasAnyRole,
} from './permissions.js';

const CSE = 'dept-cse';
const ECE = 'dept-ece';
const grantsOf = (role: Role, departmentId: string | null = null, adjustments = []) =>
  effectiveGrants([{ role, departmentId }], adjustments);
const sections = (grants: Grant[]) => SECTIONS.filter((section) => canOpenSection(grants, section));

describe('default templates (docs/PRODUCT.md)', () => {
  it('lets the college admin and principal manage users and setup, and not IQAC until granted', () => {
    expect(can(grantsOf('college_admin'), 'users_setup.manage', ['college'])).toBe(true);
    expect(can(grantsOf('principal'), 'users_setup.manage', ['college'])).toBe(true);
    expect(can(grantsOf('iqac'), 'users_setup.manage')).toBe(false);
    const granted = effectiveGrants([{ role: 'iqac', departmentId: null }], [{ role: 'iqac', permission: 'users_setup.manage', allowed: true }]);
    expect(can(granted, 'users_setup.manage', ['college'])).toBe(true);
  });

  it('lets a HOD manage people of their own department only', () => {
    const hod = grantsOf('hod', CSE);
    expect(can(hod, 'users_setup.manage', ['college'])).toBe(false);
    expect(departmentsFor(hod, 'users_setup.manage')).toEqual([CSE]);
    expect(sections(hod)).toContain('users');
    expect(sections(hod)).not.toContain('setup');
  });

  it('keeps the principal from uploading unless the college switches it on', () => {
    expect(can(grantsOf('principal'), 'evidence.upload')).toBe(false);
    const on = effectiveGrants([{ role: 'principal', departmentId: null }], [{ role: 'principal', permission: 'evidence.upload', allowed: true }]);
    expect(can(on, 'evidence.upload')).toBe(true);
  });

  it('gives two approval levels: HOD for the department, IQAC final, NBA coordinator final for NBA only', () => {
    expect(grantsOf('hod', CSE).find((g) => g.permission === 'evidence.approve_department')).toEqual({
      permission: 'evidence.approve_department',
      scope: 'department',
      departmentId: CSE,
    });
    expect(can(grantsOf('iqac'), 'evidence.approve_final', ['college'])).toBe(true);
    expect(can(grantsOf('nba_coord'), 'evidence.approve_final', ['college'])).toBe(false);
    expect(can(grantsOf('nba_coord'), 'evidence.approve_final', ['nba'])).toBe(true);
  });

  it('gives faculty their everyday sections and nothing administrative', () => {
    // Registers: their own profile and research; NBA: the courses they teach (both decided 2026-10-17).
    expect(sections(grantsOf('faculty', CSE))).toEqual(['dashboard', 'tasks', 'evidence', 'registers', 'nba', 'notifications']);
  });
});

describe('safety rules', () => {
  it('never lets a college switch off the college admin’s user management or permission management', () => {
    const adjustments = [
      { role: 'college_admin' as const, permission: 'users_setup.manage' as const, allowed: false },
      { role: 'college_admin' as const, permission: 'permissions.manage' as const, allowed: false },
    ];
    const grants = effectiveGrants([{ role: 'college_admin', departmentId: null }], adjustments);
    expect(can(grants, 'users_setup.manage', ['college'])).toBe(true);
    expect(can(grants, 'permissions.manage')).toBe(true);
  });

  it('cannot give a role a permission its template does not list', () => {
    const grants = effectiveGrants([{ role: 'faculty', departmentId: CSE }], [{ role: 'faculty', permission: 'users_setup.manage', allowed: true }]);
    expect(can(grants, 'users_setup.manage')).toBe(false);
  });

  it('gives a department-scoped duty nothing when it has no department', () => {
    expect(departmentsFor(grantsOf('hod', null), 'users_setup.manage')).toEqual([]);
  });

  it('adds up every duty a person holds, each with its own department', () => {
    const grants = effectiveGrants(
      [
        { role: 'hod', departmentId: CSE },
        { role: 'hod', departmentId: ECE },
        { role: 'nirf_coord', departmentId: null },
      ],
      [],
    );
    expect(departmentsFor(grants, 'evidence.approve_department').sort()).toEqual([CSE, ECE]);
    expect(can(grants, 'reports.generate', ['nirf'])).toBe(true);
  });

  it('lets a super admin do everything, and a person with no roles only the open sections', () => {
    const all = effectiveGrants([{ role: 'super_admin', departmentId: null }], []);
    expect(PERMISSIONS.every((permission) => can(all, permission, ['college']))).toBe(true);
    expect(sections([])).toEqual(['dashboard', 'tasks', 'evidence', 'notifications']);
  });

  it('has a template for every college role', () => {
    for (const role of ROLES.filter((r) => r !== 'super_admin')) {
      expect(ROLE_TEMPLATES[role as Exclude<Role, 'super_admin'>], role).toBeDefined();
    }
  });
});

describe('hasAnyRole', () => {
  it('needs one matching role', () => {
    expect(hasAnyRole(['faculty', 'hod'], ['hod', 'iqac'])).toBe(true);
    expect(hasAnyRole(['faculty'], ['hod', 'iqac'])).toBe(false);
  });
});
