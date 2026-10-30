import type { Role } from './index.js';

// Permission model (docs/PRODUCT.md, "Permissions"). Access is decided by permissions, never by role names.
// A role is only a default set of permissions (ROLE_TEMPLATES); each college can switch template entries on
// or off for its own people (CollegeRolePermission in the database).

export const PERMISSIONS = [
  'evidence.upload',
  'evidence.approve_department',
  'evidence.approve_final',
  'dashboards.view',
  'reports.generate',
  'users_setup.manage',
  'permissions.manage',
  'iqac_setup.grant',
  'registers.edit',
  'surveys.manage',
  'tasks.assign',
  'nba.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'evidence.upload': 'Upload evidence',
  'evidence.approve_department': 'Approve evidence, department level',
  'evidence.approve_final': 'Approve evidence, final',
  'dashboards.view': 'View dashboards',
  'reports.generate': 'Generate and download reports',
  'users_setup.manage': 'Manage users and setup',
  'permissions.manage': 'Manage permissions',
  'iqac_setup.grant': 'Give IQAC "Manage users and setup"',
  'registers.edit': 'Maintain data registers',
  'surveys.manage': 'Run surveys',
  'tasks.assign': 'Assign tasks',
  'nba.manage': 'Manage NBA courses and outcomes',
};

/**
 * How far a permission reaches.
 * college: everything in the college · department: the departments of that role assignment ·
 * own: the person's own items · nba / nirf: only that body's work.
 */
export const SCOPES = ['college', 'department', 'own', 'nba', 'nirf'] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_LABELS: Record<Scope, string> = {
  college: 'Whole college',
  department: 'Own department',
  own: 'Own items',
  nba: 'NBA only',
  nirf: 'NIRF only',
};

export interface TemplateEntry {
  scope: Scope;
  /** On by default for this role. */
  on: boolean;
  /** A college cannot change this entry (prevents a college locking itself out). */
  locked?: boolean;
}

/** Roles a college gives to its people (super admin is Yubhian's own). */
export type CollegeRole = Exclude<Role, 'super_admin'>;

/**
 * Default permissions per role. An entry missing here cannot be given to that role at all.
 * Changing a default here changes it for every college that has not adjusted that entry.
 */
export const ROLE_TEMPLATES: Record<CollegeRole, Partial<Record<Permission, TemplateEntry>>> = {
  college_admin: {
    'evidence.upload': { scope: 'own', on: false },
    'dashboards.view': { scope: 'college', on: true },
    'reports.generate': { scope: 'college', on: true },
    'users_setup.manage': { scope: 'college', on: true, locked: true },
    'permissions.manage': { scope: 'college', on: true, locked: true },
    'registers.edit': { scope: 'college', on: true },
    'tasks.assign': { scope: 'college', on: true },
  },
  principal: {
    'evidence.upload': { scope: 'own', on: false },
    'evidence.approve_final': { scope: 'college', on: false },
    'dashboards.view': { scope: 'college', on: true },
    'reports.generate': { scope: 'college', on: true },
    'users_setup.manage': { scope: 'college', on: true },
    'iqac_setup.grant': { scope: 'college', on: true },
    'registers.edit': { scope: 'college', on: false },
    'tasks.assign': { scope: 'college', on: true },
  },
  iqac: {
    'evidence.upload': { scope: 'own', on: true },
    'evidence.approve_final': { scope: 'college', on: true },
    'dashboards.view': { scope: 'college', on: true },
    'reports.generate': { scope: 'college', on: true },
    'users_setup.manage': { scope: 'college', on: false },
    'registers.edit': { scope: 'college', on: true },
    'surveys.manage': { scope: 'college', on: true },
    'tasks.assign': { scope: 'college', on: true },
    'nba.manage': { scope: 'college', on: true },
  },
  hod: {
    'evidence.upload': { scope: 'own', on: true },
    'evidence.approve_department': { scope: 'department', on: true },
    'dashboards.view': { scope: 'department', on: true },
    'reports.generate': { scope: 'department', on: true },
    'users_setup.manage': { scope: 'department', on: true },
    'registers.edit': { scope: 'department', on: true },
    'tasks.assign': { scope: 'department', on: true },
    'nba.manage': { scope: 'department', on: true },
  },
  nba_coord: {
    'evidence.upload': { scope: 'own', on: true },
    'evidence.approve_final': { scope: 'nba', on: true },
    'dashboards.view': { scope: 'college', on: true },
    'reports.generate': { scope: 'nba', on: true },
    'surveys.manage': { scope: 'nba', on: true },
    'tasks.assign': { scope: 'college', on: true },
    'nba.manage': { scope: 'college', on: true },
  },
  nirf_coord: {
    'evidence.upload': { scope: 'own', on: true },
    'dashboards.view': { scope: 'college', on: true },
    'reports.generate': { scope: 'nirf', on: true },
    'tasks.assign': { scope: 'college', on: true },
  },
  faculty: {
    'evidence.upload': { scope: 'own', on: true },
    'dashboards.view': { scope: 'own', on: true },
    // Their own faculty profile and research entries (decided 2026-10-17).
    'registers.edit': { scope: 'own', on: true },
    // The courses they teach: COs, mapping and results (decided 2026-10-17).
    'nba.manage': { scope: 'own', on: true },
  },
  office: {
    'evidence.upload': { scope: 'own', on: true },
    'dashboards.view': { scope: 'own', on: false },
    'registers.edit': { scope: 'college', on: true },
  },
};

/** A college's switch on one template entry. No adjustment means the template default applies. */
export interface PermissionAdjustment {
  role: CollegeRole;
  permission: Permission;
  allowed: boolean;
}

/** One thing a signed-in person may do. `departmentId` is set when the scope is "department". */
export interface Grant {
  permission: Permission;
  scope: Scope;
  departmentId: string | null;
}

/** Everything a person may do, from their roles, the templates and their college's adjustments. */
export function effectiveGrants(
  assignments: readonly { role: Role; departmentId: string | null }[],
  adjustments: readonly PermissionAdjustment[],
): Grant[] {
  if (assignments.some((assignment) => assignment.role === 'super_admin')) {
    return PERMISSIONS.map((permission) => ({ permission, scope: 'college', departmentId: null }));
  }
  const adjusted = new Map(adjustments.map((a) => [`${a.role}:${a.permission}`, a.allowed]));
  const grants = new Map<string, Grant>();
  for (const { role, departmentId } of assignments) {
    const template = ROLE_TEMPLATES[role as CollegeRole];
    for (const [permission, entry] of Object.entries(template) as [Permission, TemplateEntry][]) {
      const allowed = entry.locked ? entry.on : (adjusted.get(`${role}:${permission}`) ?? entry.on);
      if (!allowed) continue;
      // A department-scoped duty without a department reaches nothing.
      if (entry.scope === 'department' && !departmentId) continue;
      const grant = { permission, scope: entry.scope, departmentId: entry.scope === 'department' ? departmentId : null };
      grants.set(`${permission}:${grant.scope}:${grant.departmentId}`, grant);
    }
  }
  return [...grants.values()];
}

/** True when any grant gives `permission`, optionally limited to the given scopes. */
export function can(grants: readonly Grant[], permission: Permission, scopes?: readonly Scope[]): boolean {
  return grants.some((grant) => grant.permission === permission && (!scopes || scopes.includes(grant.scope)));
}

/** Departments reached by a permission's department-scoped grants. */
export function departmentsFor(grants: readonly Grant[], permission: Permission): string[] {
  return grants.filter((g) => g.permission === permission && g.scope === 'department' && g.departmentId).map((g) => g.departmentId!);
}

// ------------------------------------------------------------------ Sections (sidebar and API modules)

export const SECTIONS = [
  'dashboard',
  'tasks',
  'evidence',
  'registers',
  'naac',
  'nba',
  'nirf',
  'aishe',
  'review',
  'surveys',
  'reports',
  'notifications',
  'users',
  'setup',
  'audit',
] as const;
export type Section = (typeof SECTIONS)[number];

/** A section opens when any one of these holds. An empty list means every signed-in person. */
export const SECTION_ACCESS: Record<Section, readonly { permission: Permission; scopes?: readonly Scope[] }[]> = {
  dashboard: [],
  tasks: [],
  evidence: [],
  notifications: [],
  // People who view college or department dashboards can read registers (decided 2026-10-17).
  registers: [{ permission: 'registers.edit' }, { permission: 'dashboards.view', scopes: ['college', 'department'] }],
  naac: [{ permission: 'dashboards.view', scopes: ['college', 'department'] }],
  nba: [
    { permission: 'dashboards.view', scopes: ['college', 'department'] },
    { permission: 'reports.generate', scopes: ['nba'] },
    { permission: 'nba.manage' },
  ],
  nirf: [{ permission: 'dashboards.view', scopes: ['college'] }, { permission: 'reports.generate', scopes: ['nirf'] }],
  // College-wide dashboard viewers (decided 2026-10-18).
  aishe: [{ permission: 'dashboards.view', scopes: ['college'] }],
  review: [{ permission: 'evidence.approve_department' }, { permission: 'evidence.approve_final' }],
  surveys: [{ permission: 'surveys.manage' }],
  reports: [{ permission: 'reports.generate' }],
  users: [{ permission: 'users_setup.manage' }, { permission: 'permissions.manage' }, { permission: 'iqac_setup.grant' }],
  setup: [{ permission: 'users_setup.manage', scopes: ['college'] }],
  // College admin and principal (decided 2026-10-18).
  audit: [{ permission: 'permissions.manage' }, { permission: 'users_setup.manage', scopes: ['college'] }],
};

export function canOpenSection(grants: readonly Grant[], section: Section): boolean {
  const rules = SECTION_ACCESS[section];
  return rules.length === 0 || rules.some((rule) => can(grants, rule.permission, rule.scopes));
}

// ------------------------------------------------------------------ Safety rules no college setting changes

/** Only these roles may give, remove or edit the college admin role. */
export const CAN_GRANT_COLLEGE_ADMIN: readonly Role[] = ['college_admin'];

/** True when the person holds at least one of `allowed`. Super admins always pass. */
export function hasAnyRole(held: readonly Role[], allowed: readonly Role[]): boolean {
  return held.some((role) => role === 'super_admin' || allowed.includes(role));
}
