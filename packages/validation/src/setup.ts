import { ACCREDITATION_BODIES, COLLEGE_TYPES, PERMISSIONS, ROLES, ROLE_LABELS, type Role } from '@yucampus/types';
import { z } from 'zod';
import { emailSchema, mobileSchema } from './auth.js';

const text = (label: string, max = 200) =>
  z.string().trim().min(1, `Enter ${label}`).max(max, `Keep ${label} under ${max} characters`);
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullish();

/** A calendar date as YYYY-MM-DD. */
export const isoDateSchema = z.iso.date('Enter a date');

// ------------------------------------------------------------------ Institution profile

export const institutionProfileSchema = z.object({
  name: text('the college name'),
  type: z.enum(COLLEGE_TYPES, 'Choose the institution type'),
  state: text('the state', 60),
  city: optionalText(80),
  aisheCode: optionalText(20),
  affiliatingUniversity: optionalText(),
  establishedYear: z.coerce
    .number()
    .int()
    .min(1800, 'Enter a year after 1800')
    .max(new Date().getFullYear(), 'The year cannot be in the future')
    .nullish(),
  /** 2: HOD approves for the department, then IQAC gives final approval. 1: IQAC approves directly. */
  approvalLevels: z.coerce.number().int().min(1).max(2).default(2),
});
export type InstitutionProfileInput = z.input<typeof institutionProfileSchema>;
export type InstitutionProfileValues = z.output<typeof institutionProfileSchema>;

// ------------------------------------------------------------------ Frameworks and assessment cycles

export const cycleSchema = z
  .object({
    body: z.enum(ACCREDITATION_BODIES),
    label: text('a name for the cycle', 60),
    startDate: isoDateSchema.nullish(),
    endDate: isoDateSchema.nullish(),
  })
  .refine((cycle) => !cycle.startDate || !cycle.endDate || cycle.endDate > cycle.startDate, {
    message: 'The cycle must end after it starts',
    path: ['endDate'],
  });
export type CycleInput = z.infer<typeof cycleSchema>;

/** The frameworks of one body that are active for the college (in one cycle, if the body uses cycles). */
export const collegeFrameworksSchema = z.object({
  body: z.enum(ACCREDITATION_BODIES),
  cycleId: z.uuid().nullable(),
  frameworkIds: z.array(z.uuid()).max(20),
});
export type CollegeFrameworksInput = z.infer<typeof collegeFrameworksSchema>;

/** The framework a program is assessed against (NBA), or null for none. */
export const programFrameworkSchema = z.object({ frameworkId: z.uuid().nullable() });
export type ProgramFrameworkInput = z.infer<typeof programFrameworkSchema>;

// ------------------------------------------------------------------ Permissions

export const permissionChangeSchema = z.object({
  role: z.enum(ROLES.filter((role): role is Exclude<Role, 'super_admin'> => role !== 'super_admin')),
  permission: z.enum(PERMISSIONS),
  allowed: z.boolean(),
});

// ------------------------------------------------------------------ Departments and programs

export const PROGRAM_LEVELS = ['UG', 'PG', 'Diploma', 'PhD'] as const;

export const departmentCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9&-]{1,11}$/, 'Use 2 to 12 letters or digits, starting with a letter, e.g. CSE');

export const programSchema = z.object({
  name: text('the program name'),
  level: z.enum(PROGRAM_LEVELS, 'Choose the level'),
});
export type ProgramInput = z.infer<typeof programSchema>;

export const createDepartmentSchema = z.object({
  name: text('the department name'),
  code: departmentCodeSchema,
  programs: z.array(programSchema).max(20).default([]),
});
export type CreateDepartmentInput = z.input<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z.object({
  name: text('the department name'),
  code: departmentCodeSchema,
  /** The head of department. null removes the current one. */
  hodUserId: z.uuid().nullable(),
});
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

// ------------------------------------------------------------------ Users and roles

/** Roles a college can give. Super admin belongs to the Yubhian team only. */
export const ASSIGNABLE_ROLES = ROLES.filter((role): role is Exclude<Role, 'super_admin'> => role !== 'super_admin');

/** Duties that belong to one department. All others are college-wide. */
export const DEPARTMENT_ROLES: readonly Role[] = ['hod', 'faculty'];

export const roleAssignmentSchema = z
  .object({
    role: z.enum(ASSIGNABLE_ROLES, 'Choose a role'),
    departmentId: z.uuid().nullish(),
  })
  .refine((value) => !DEPARTMENT_ROLES.includes(value.role) || value.departmentId, {
    message: 'Choose the department for this role',
    path: ['departmentId'],
  })
  .transform((value) => ({ role: value.role, departmentId: value.departmentId ?? null }));
export type RoleAssignmentInput = z.input<typeof roleAssignmentSchema>;

// A blank string means "not given" (forms and spreadsheets send "" for empty fields).
const blankOr = <T extends z.ZodType<unknown, string>>(schema: T) =>
  z
    .string()
    .trim()
    .transform((value) => value || null)
    .pipe(schema.nullable());
const emailOrBlank = blankOr(emailSchema);
const mobileOrBlank = blankOr(mobileSchema);
const optionalEmail = emailOrBlank.nullish().transform((value) => value ?? null);
const optionalMobile = mobileOrBlank.nullish().transform((value) => value ?? null);

export const userInputSchema = z
  .object({
    name: text('the name', 120),
    email: optionalEmail,
    mobile: optionalMobile,
    roles: z.array(roleAssignmentSchema).min(1, 'Give at least one role').max(10),
  })
  .refine((user) => user.email || user.mobile, {
    message: 'Enter an email or a mobile number, so they can sign in',
    path: ['email'],
  })
  .refine(
    (user) => new Set(user.roles.map((r) => `${r.role}:${r.departmentId}`)).size === user.roles.length,
    { message: 'The same role is listed twice', path: ['roles'] },
  );
export type UserInput = z.input<typeof userInputSchema>;
export type UserInputParsed = z.output<typeof userInputSchema>;

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  search: z.string().trim().max(100).optional(),
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  status: z.enum(['active', 'invited', 'not_joined']).optional(),
  departmentId: z.uuid().optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

// ------------------------------------------------------------------ Excel import

/** Column headings of the import sheet, in order. The template download uses the same list. */
export const USER_IMPORT_COLUMNS = ['Name', 'Email', 'Mobile', 'Role', 'Department code'] as const;
export const MAX_IMPORT_ROWS = 500;

const ROLE_ALIASES: Record<string, Exclude<Role, 'super_admin'>> = {
  admin: 'college_admin',
  principal: 'principal',
  dean: 'principal',
  iqac: 'iqac',
  hod: 'hod',
  'head of department': 'hod',
  nba: 'nba_coord',
  'nba coordinator': 'nba_coord',
  nirf: 'nirf_coord',
  'nirf coordinator': 'nirf_coord',
  faculty: 'faculty',
  teacher: 'faculty',
  office: 'office',
  staff: 'office',
};
for (const role of ASSIGNABLE_ROLES) {
  ROLE_ALIASES[role] = role;
  ROLE_ALIASES[ROLE_LABELS[role].toLowerCase()] = role;
}

/** Reads a role written by a person in a spreadsheet ("HOD", "IQAC coordinator", "faculty"…). */
export function parseRoleName(value: string): Exclude<Role, 'super_admin'> | null {
  return ROLE_ALIASES[value.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

const cell = z.union([z.string(), z.number()]).nullish().transform((value) => (value == null ? '' : String(value).trim()));

/** One spreadsheet row. Department is a code (e.g. CSE); the API turns it into an id. */
export const userImportRowSchema = z
  .object({
    name: cell.pipe(text('the name', 120)),
    email: cell.pipe(emailOrBlank),
    mobile: cell.pipe(mobileOrBlank),
    role: cell.pipe(
      z
        .string()
        .min(1, 'Enter a role')
        .transform((value, context) => {
          const role = parseRoleName(value);
          if (!role) {
            context.addIssue({ code: 'custom', message: `"${value}" is not a role we know` });
            return z.NEVER;
          }
          return role;
        }),
    ),
    departmentCode: cell.pipe(z.string().transform((value) => value.toUpperCase() || null)),
  })
  .refine((row) => row.email || row.mobile, { message: 'Enter an email or a mobile number', path: ['email'] })
  .refine((row) => !DEPARTMENT_ROLES.includes(row.role) || row.departmentCode, {
    message: 'This role needs a department code',
    path: ['departmentCode'],
  });
export type UserImportRow = z.input<typeof userImportRowSchema>;

export const userImportSchema = z.object({
  rows: z.array(z.unknown()).min(1, 'The file has no rows').max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} people at a time`),
  /** true: only check the rows and report problems; nothing is saved. */
  dryRun: z.boolean().default(true),
});
export type UserImportInput = z.input<typeof userImportSchema>;

// ------------------------------------------------------------------ Academic year

export const termSchema = z
  .object({ name: text('the term name', 40), start: isoDateSchema, end: isoDateSchema })
  .refine((term) => term.end > term.start, { message: 'The term must end after it starts', path: ['end'] });

export const academicYearDatesSchema = z
  .object({
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    terms: z.array(termSchema).max(4),
  })
  .refine((year) => year.endDate > year.startDate, { message: 'The year must end after it starts', path: ['endDate'] })
  .refine((year) => year.terms.every((term) => term.start >= year.startDate && term.end <= year.endDate), {
    message: 'Semesters must fall inside the year',
    path: ['terms'],
  });
export type AcademicYearDatesInput = z.infer<typeof academicYearDatesSchema>;

export const keyDateSchema = z.object({
  title: text('what is due', 120),
  date: isoDateSchema,
  /** How many days before the date to remind people. */
  remindDaysBefore: z.coerce.number().int().min(0).max(90).default(7),
});
export type KeyDateInput = z.input<typeof keyDateSchema>;

// ------------------------------------------------------------------ Sign-in with Google or Microsoft (2026-10-21)

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.string().regex(/^(?=.{3,120}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, 'Enter a domain like srec.ac.in'));

export const ssoSettingsSchema = z
  .object({
    google: z.boolean(),
    microsoft: z.boolean(),
    domains: z.array(domainSchema).max(10, 'At most 10 domains').transform((list) => [...new Set(list)]),
  })
  .refine((value) => !(value.google || value.microsoft) || value.domains.length > 0, {
    message: 'Add at least one email domain, e.g. srec.ac.in',
    path: ['domains'],
  });
export type SsoSettingsInput = z.input<typeof ssoSettingsSchema>;
export type SsoSettingsValues = z.output<typeof ssoSettingsSchema>;

export const ssoFinishSchema = z.object({ code: z.string().min(20).max(200) });
