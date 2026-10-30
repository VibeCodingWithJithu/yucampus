import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from '@yucampus/types';
import { z } from 'zod';
import { emailSchema } from './auth.js';
import { isoDateSchema } from './setup.js';

export const TASK_REPEATS = ['none', 'month', 'semester', 'year'] as const;
export const TASK_REMINDERS = ['three_days', 'one_week', 'overdue_daily'] as const;

/** What the reminder choices mean (labels from the Tasks design). */
export const REMINDER_RULES: Record<(typeof TASK_REMINDERS)[number], { label: string; daysBefore: number[]; overdueDaily: boolean }> = {
  three_days: { label: '3 days before and on the due date', daysBefore: [3, 0], overdueDaily: false },
  one_week: { label: '1 week before', daysBefore: [7], overdueDaily: false },
  overdue_daily: { label: 'On the due date, then daily when overdue', daysBefore: [0], overdueDaily: true },
};

export const REPEAT_LABELS: Record<(typeof TASK_REPEATS)[number], string> = {
  none: 'Only once',
  month: 'Every month',
  semester: 'Every semester (6 months)',
  year: 'Every academic year',
};

export const assigneeSchema = z.object({ kind: z.enum(['user', 'department']), id: z.uuid('Choose who it is for') });

export const taskInputSchema = z.object({
  title: z.string().trim().min(3, 'Say what needs to be done').max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((value) => value || null)
    .nullish(),
  metricId: z.uuid().nullish(),
  documentKey: z.string().max(40).nullish(),
  assignee: assigneeSchema,
  dueDate: isoDateSchema,
  repeat: z.enum(TASK_REPEATS).default('none'),
  reminders: z.enum(TASK_REMINDERS).default('three_days'),
});
export type TaskInput = z.input<typeof taskInputSchema>;
export type TaskValues = z.output<typeof taskInputSchema>;

/** One task per required document still missing in a criterion (or in every criterion). */
export const gapTasksSchema = z.object({
  frameworkId: z.uuid(),
  criterionNumber: z.number().int().min(1).max(20).nullish(),
  assignee: assigneeSchema,
  dueDate: isoDateSchema,
  reminders: z.enum(TASK_REMINDERS).default('three_days'),
});
export type GapTasksInput = z.input<typeof gapTasksSchema>;

export const notificationPreferencesSchema = z.object({
  events: z
    .array(z.object({ event: z.enum(NOTIFICATION_EVENTS), channels: z.array(z.enum(NOTIFICATION_CHANNELS)).max(3) }))
    .max(NOTIFICATION_EVENTS.length),
  emailDigest: z.enum(['instant', '09', '17']),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

export const notificationsQuerySchema = z.object({
  filter: z.enum(['all', 'unread', 'deadlines', 'tasks']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
});
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

// ------------------------------------------------------------------ Passwords

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .refine((value) => /[A-Za-z]/.test(value) && /[^A-Za-z]/.test(value), 'Mix letters with numbers or symbols');

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const setPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
