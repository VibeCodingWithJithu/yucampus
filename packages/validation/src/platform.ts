import { COLLEGE_TYPES, RESERVED_SUBDOMAINS } from '@yucampus/types';
import { z } from 'zod';
import { emailSchema } from './auth.js';

// The platform panel for the YuCampus team (decided 2026-10-18).

const name = (label: string, max = 120) => z.string().trim().min(2, `Enter ${label}`).max(max, `Keep ${label} under ${max} characters`);

export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/, 'Use 3 to 32 lowercase letters, digits or hyphens (not at the start or end)')
  .refine((value) => !(RESERVED_SUBDOMAINS as readonly string[]).includes(value), 'That address is reserved for YuCampus');

export const PLANS = ['trial', 'basic', 'standard', 'premium'] as const;

export const createCollegeSchema = z.object({
  name: name('the college name', 200),
  type: z.enum(COLLEGE_TYPES, 'Choose the institution type'),
  state: name('the state', 60),
  subdomain: subdomainSchema,
  plan: z.enum(PLANS).default('trial'),
  adminName: name("the college admin's name"),
  adminEmail: emailSchema,
});
export type CreateCollegeInput = z.input<typeof createCollegeSchema>;
export type CreateCollegeValues = z.output<typeof createCollegeSchema>;

export const collegeStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  /** Kept in both audit logs. */
  reason: z.string().trim().min(5, 'Say why, in a few words').max(300),
});
export type CollegeStatusInput = z.infer<typeof collegeStatusSchema>;

export const collegePlanSchema = z.object({ plan: z.enum(PLANS) });
export type CollegePlanInput = z.infer<typeof collegePlanSchema>;

export const platformInviteSchema = z.object({ name: name('their name'), email: emailSchema });
export type PlatformInviteInput = z.infer<typeof platformInviteSchema>;

export const platformCollegeQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});
export type PlatformCollegeQuery = z.infer<typeof platformCollegeQuerySchema>;

/** The second sign-in step: a 6-digit code from the app, or a recovery code like k7qm-3xdp. */
export const platformMfaSchema = z.object({
  ticket: z.string().min(20).max(2000),
  code: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s/g, ''))
    .pipe(z.string().regex(/^(\d{6}|[a-z2-7]{4}-?[a-z2-7]{4})$/i,'Enter the 6-digit code from your app, or a recovery code')),
});
export type PlatformMfaInput = z.infer<typeof platformMfaSchema>;
