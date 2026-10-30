import type { Page } from './index.js';

// The college's audit log page (decided 2026-10-18): who changed what and when.

/** Kinds of record, as written by the API's audit() calls. Unknown kinds are shown by their code. */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  academic_year: 'Academic year',
  assessment_cycle: 'Assessment cycle',
  college: 'College',
  comment: 'Comment',
  course: 'NBA course',
  department: 'Department',
  evidence: 'Evidence',
  export: 'Report export',
  key_date: 'Key date',
  permission: 'Permissions',
  program: 'Program',
  register: 'Data register',
  register_record: 'Register record',
  submitted_figure: 'Submitted figure',
  survey: 'Survey',
  task: 'Task',
  user: 'Person',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Changed',
  delete: 'Deleted',
  upload: 'Uploaded',
  resubmit: 'Uploaded again',
  invite: 'Invited',
  import: 'Imported',
  sign_in: 'Signed in',
  password_chosen: 'Chose a password',
  password_reset: 'Reset the password',
  update_profile: 'Changed the profile',
  set_frameworks: 'Changed frameworks',
  copy_year: 'Copied to a new year',
  create_from_gaps: 'Created from gaps',
  link_metrics: 'Linked to metrics',
  set_outcomes: 'Changed outcomes',
  set_mapping: 'Changed CO–PO mapping',
  set_results: 'Changed results',
  set_psos: 'Changed PSOs',
  set_profile: 'Changed vision, mission and PEOs',
  set_framework: 'Changed NBA format',
  set_attainment_rules: 'Changed attainment rules',
  indirect_from_survey: 'Indirect attainment from survey',
  start_year: 'Started the year',
  update_dates: 'Changed dates',
  platform_create: 'Set up by YuCampus',
  platform_suspend: 'Suspended by YuCampus',
  platform_reactivate: 'Reactivated by YuCampus',
  platform_plan: 'Plan changed by YuCampus',
};

/** "set_psos" -> "Changed PSOs"; unknown actions read as words ("approve_final" -> "Approve final"). */
export function auditActionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const words = action.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface AuditChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface AuditEntryView {
  id: string;
  at: string;
  /** person: someone in the college · support: the YuCampus team · system: reminders, jobs and the like. */
  actor: 'person' | 'support' | 'system';
  who: { id: string; name: string } | null;
  entity: string;
  entityLabel: string;
  entityId: string;
  action: string;
  actionLabel: string;
  changes: AuditChange[];
}

export interface AuditPage extends Page<AuditEntryView> {
  /** For the filters: people and kinds that appear in this college's log. */
  people: { id: string; name: string }[];
  entities: { key: string; label: string }[];
}

/** Rows one CSV download may hold; narrower filters for more. */
export const AUDIT_EXPORT_LIMIT = 5000;
