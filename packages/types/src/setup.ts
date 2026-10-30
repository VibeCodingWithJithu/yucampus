import type {
  AcademicYearStatus,
  AccreditationBody,
  CollegeType,
  FrameworkStatus,
  Role,
  RoleAssignment,
  UserStatus,
} from './index.js';

export interface InstitutionProfile {
  name: string;
  type: CollegeType;
  state: string;
  city: string | null;
  aisheCode: string | null;
  affiliatingUniversity: string | null;
  establishedYear: number | null;
  /** 2: HOD then IQAC. 1: IQAC only. */
  approvalLevels: 1 | 2;
  subdomain: string;
}

/** A framework version the college can choose, from the global rules tables. */
export interface FrameworkOption {
  id: string;
  body: AccreditationBody;
  code: string;
  version: string;
  name: string;
  status: FrameworkStatus;
  /** single: at most one active per cycle (NAAC). multiple: several at once (NIRF categories). */
  selection: 'single' | 'multiple';
  /** college: chosen for the whole college. program: chosen per program (NBA). */
  attachesTo: 'college' | 'program';
  /** 0 means the criteria have not been loaded into YuCampus yet. */
  criteriaCount: number;
}

export interface CycleView {
  id: string;
  body: AccreditationBody;
  label: string;
  startDate: string | null;
  endDate: string | null;
  status: 'planned' | 'active' | 'closed';
}

/** Everything the "Which frameworks apply" section needs. */
export interface FrameworksView {
  options: FrameworkOption[];
  cycles: CycleView[];
  /** Framework rows of the college; inactive ones are kept so switching back loses nothing. */
  college: { frameworkId: string; cycleId: string | null; active: boolean }[];
}

export interface ProgramView {
  id: string;
  name: string;
  level: string;
  /** The program-level framework it is assessed against (NBA), if any. */
  framework: { id: string; code: string; name: string } | null;
}

export interface DepartmentView {
  id: string;
  name: string;
  code: string;
  hod: { id: string; name: string } | null;
  programs: ProgramView[];
  facultyCount: number;
}

export interface UserView {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  status: UserStatus;
  roles: (RoleAssignment & { departmentCode: string | null })[];
  lastLoginAt: string | null;
}

export type UserCounts = Record<UserStatus | 'total', number>;

export interface UserImportProblem {
  /** 1-based spreadsheet row number, counting the heading row as row 1. */
  row: number;
  message: string;
}

export interface UserImportResult {
  /** Rows that are (or, in a dry run, would be) added. */
  created: number;
  /** Rows skipped because that email or mobile already belongs to someone in the college. */
  skipped: number;
  problems: UserImportProblem[];
  saved: boolean;
}

export interface Term {
  name: string;
  start: string;
  end: string;
}

export interface KeyDateView {
  id: string;
  title: string;
  date: string;
  remindDaysBefore: number;
}

export interface AcademicYearView {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: AcademicYearStatus;
  terms: Term[];
  keyDates: KeyDateView[];
}

export type SetupStepState = 'done' | 'current' | 'todo' | 'later';

export interface SetupStep {
  key: 'profile' | 'departments' | 'users' | 'calendar' | 'templates';
  title: string;
  state: SetupStepState;
  /** Short plain-English status, e.g. "6 departments". */
  detail: string;
}

/** Roles shown in the "what each role can do" table and the role filter, in display order. */
export const ROLE_DISPLAY_ORDER: readonly Role[] = [
  'college_admin',
  'principal',
  'iqac',
  'hod',
  'nba_coord',
  'nirf_coord',
  'faculty',
  'office',
];

// ------------------------------------------------------------------ Sign-in with Google or Microsoft (2026-10-21)

export const SSO_PROVIDERS = ['google', 'microsoft'] as const;
export type SsoProvider = (typeof SSO_PROVIDERS)[number];
export const SSO_PROVIDER_LABELS: Record<SsoProvider, string> = { google: 'Google', microsoft: 'Microsoft' };

/** A college's SSO settings, and which providers this server has been set up for. */
export interface SsoSettingsView {
  google: boolean;
  microsoft: boolean;
  /** Email domains allowed to sign in this way, e.g. ["srec.ac.in"]. */
  domains: string[];
  available: Record<SsoProvider, boolean>;
}

/** What the sign-in page shows: providers both turned on by the college and available on this server. */
export type SsoOptions = Record<SsoProvider, boolean>;
