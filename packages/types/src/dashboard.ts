import type { ReadinessStatus } from './accreditation.js';

/** The principal dashboard (design: Main.dc.html). College-wide, or a HOD's own departments. */
export interface DashboardView {
  scope: 'college' | 'department';
  /** The year the counts are for; readiness always covers every year each metric needs. */
  academicYear: { id: string; label: string };
  years: { id: string; label: string; status: string }[];
  naac: DashboardNaac | null;
  evidence: { uploaded: number; thisWeek: number; approved: number };
  review: { pending: number; oldestDays: number | null };
  deadlines: DashboardDeadline[];
  programs: DashboardProgram[];
  departments: DashboardDepartment[];
  activity: DashboardActivity[];
}

export interface DashboardNaac {
  frameworkId: string;
  frameworkName: string;
  verified: boolean;
  percent: number;
  status: ReadinessStatus;
  /** Percentage points since 30 days ago (counting final approvals made by then); null before any approval. */
  change: number | null;
  /** Required documents still without finally approved evidence, and how many metrics they are in. */
  missingDocuments: number;
  metricsWithGaps: number;
  criteria: { number: number; name: string; percent: number; status: ReadinessStatus; pending: boolean }[];
}

export interface DashboardDeadline {
  id: string;
  title: string;
  date: string;
  daysLeft: number;
}

export interface DashboardProgram {
  id: string;
  name: string;
  departmentCode: string;
  /** The NBA format chosen for it (e.g. "Engineering · Tier I"), or null. */
  nbaFormat: string | null;
}

export interface DashboardDepartment {
  id: string;
  code: string;
  name: string;
  uploaded: number;
  inReview: number;
  openTasks: number;
  faculty: number;
  facultyYetToUpload: number;
  /** Tasks done out of tasks given this year (to the department or its people); null when none were given. */
  tasksPercent: number | null;
}

export type DashboardActivityKind = 'upload' | 'approved' | 'sent_back' | 'task';

export interface DashboardActivity {
  id: string;
  kind: DashboardActivityKind;
  text: string;
  at: string;
  link: string | null;
}
