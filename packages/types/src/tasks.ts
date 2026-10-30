import type { AccreditationBody, NotificationChannel } from './index.js';

/** Where a task is, worked out from the evidence uploaded for it (TaskBoard columns). */
export type TaskStage = 'to_do' | 'in_progress' | 'submitted' | 'approved';

export const TASK_STAGE_LABELS: Record<TaskStage, string> = {
  to_do: 'To do',
  in_progress: 'In progress',
  submitted: 'Submitted',
  approved: 'Approved',
};

export type TaskRepeat = 'none' | 'month' | 'semester' | 'year';
export type TaskReminders = 'three_days' | 'one_week' | 'overdue_daily';

export interface TaskAssignee {
  kind: 'user' | 'department';
  id: string;
  name: string;
}

export interface TaskView {
  id: string;
  title: string;
  description: string | null;
  metric: { id: string; code: string; name: string; body: AccreditationBody } | null;
  documentKey: string | null;
  documentName: string | null;
  assignee: TaskAssignee;
  dueDate: string;
  repeat: TaskRepeat;
  reminders: TaskReminders;
  stage: TaskStage;
  overdue: boolean;
  createdBy: string;
  evidence: { id: string; title: string; status: string }[];
  /** What the person asking may do with it. */
  can: { edit: boolean; upload: boolean };
}

export interface TaskBoard {
  tasks: TaskView[];
  overdue: number;
}

/** Whom the person may give tasks to (all of the college, or their own departments). */
export interface TaskAssignees {
  departments: { id: string; code: string; name: string }[];
  people: { id: string; name: string; detail: string }[];
}

export interface GapTasksResult {
  created: number;
  /** Missing documents that already have an open task. */
  skipped: number;
}

// ------------------------------------------------------------------ Notifications

/** Events people can choose channels for. Each notification kind belongs to one event. */
export const NOTIFICATION_EVENTS = ['task_assigned', 'deadline', 'evidence_result', 'review_waiting', 'key_date'] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  task_assigned: 'New task for me',
  deadline: 'Deadline approaching or passed',
  evidence_result: 'Upload approved or sent back',
  review_waiting: 'Item waiting for my review',
  key_date: 'College key dates',
};

/** Defaults when a person has not chosen. WhatsApp comes later, so it is never on by default. */
export const DEFAULT_CHANNELS: Record<NotificationEvent, NotificationChannel[]> = {
  task_assigned: ['in_app', 'email'],
  deadline: ['in_app', 'email'],
  evidence_result: ['in_app', 'email'],
  review_waiting: ['in_app'],
  key_date: ['in_app', 'email'],
};

export const NOTIFICATION_KINDS = [
  'task_assigned',
  'task_due',
  'task_overdue',
  'evidence_approved',
  'evidence_needs_fix',
  'evidence_rejected',
  'review_waiting',
  'key_date',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const EVENT_OF_KIND: Record<NotificationKind, NotificationEvent> = {
  task_assigned: 'task_assigned',
  task_due: 'deadline',
  task_overdue: 'deadline',
  evidence_approved: 'evidence_result',
  evidence_needs_fix: 'evidence_result',
  evidence_rejected: 'evidence_result',
  review_waiting: 'review_waiting',
  key_date: 'key_date',
};

export interface NotificationView {
  id: string;
  kind: NotificationKind;
  text: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationView[];
  unread: number;
  total: number;
}

export type EmailDigest = 'instant' | '09' | '17';

export interface NotificationPreferences {
  events: { event: NotificationEvent; label: string; channels: NotificationChannel[] }[];
  emailDigest: EmailDigest;
}
