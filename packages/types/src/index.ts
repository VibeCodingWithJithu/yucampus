// Shared domain vocabulary. The database enums in apps/api/prisma/schema.prisma use the same values.

export * from './accreditation.js';
export * from './auth.js';
export * from './permissions.js';
export * from './evidence.js';
export * from './setup.js';
export * from './tasks.js';
export * from './dashboard.js';
export * from './reports.js';
export * from './registers.js';
export * from './nba.js';
export * from './surveys.js';
export * from './nirf.js';
export * from './aishe.js';
export * from './audit.js';
export * from './platform.js';

export const ROLES = [
  'super_admin',
  'college_admin',
  'principal',
  'iqac',
  'hod',
  'nba_coord',
  'nirf_coord',
  'faculty',
  'office',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super admin',
  college_admin: 'College admin',
  principal: 'Principal / Dean',
  iqac: 'IQAC coordinator',
  hod: 'Head of department',
  nba_coord: 'NBA coordinator',
  nirf_coord: 'NIRF coordinator',
  faculty: 'Faculty',
  office: 'Office staff',
};

export const COLLEGE_TYPES = ['affiliated', 'autonomous', 'university'] as const;
export type CollegeType = (typeof COLLEGE_TYPES)[number];

export const USER_STATUSES = ['active', 'invited', 'not_joined'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ACADEMIC_YEAR_STATUSES = ['current', 'locked', 'next'] as const;
export type AcademicYearStatus = (typeof ACADEMIC_YEAR_STATUSES)[number];

export const ACCREDITATION_BODIES = ['NAAC', 'NBA', 'NIRF', 'AISHE'] as const;
export type AccreditationBody = (typeof ACCREDITATION_BODIES)[number];

export const FRAMEWORK_STATUSES = ['draft', 'active', 'retired'] as const;
export type FrameworkStatus = (typeof FRAMEWORK_STATUSES)[number];

export const METRIC_TYPES = ['quantitative', 'qualitative'] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

export const EVIDENCE_STATUSES = ['in_review', 'department_approved', 'approved', 'needs_fix', 'rejected'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** Every status is shown with a colour AND this text label (accessibility rule). */
export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  in_review: 'In review',
  department_approved: 'Approved by HOD',
  approved: 'Approved',
  needs_fix: 'Needs fix',
  rejected: 'Rejected',
};

export const TASK_STATUSES = ['open', 'in_progress', 'done', 'overdue'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'whatsapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Standard page shape for every list endpoint (20-50 rows per page). */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
