import { z } from 'zod';
import { metricMeasureSchema } from './rules.js';

// AISHE data forms and the consistency checker (decided 2026-10-18). Both are rules files in apps/api/rules/aishe.

const sourceSchema = z.object({ title: z.string().trim().min(3).max(400), verified: z.boolean() });
const keySchema = z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/);

export const AISHE_PROFILE_FIELDS = ['aisheCode', 'name', 'type', 'state', 'city', 'affiliatingUniversity', 'establishedYear'] as const;
export type AisheProfileField = (typeof AISHE_PROFILE_FIELDS)[number];

/** Portals a college submits figures to. Nothing is sent to them; YuCampus records what was submitted. */
export const SUBMISSION_PORTALS = ['AISHE', 'NIRF', 'NAAC'] as const;
export type SubmissionPortal = (typeof SUBMISSION_PORTALS)[number];

export const aisheSurveySchema = z.object({
  version: z.string().trim().min(1).max(20),
  source: sourceSchema,
  blocks: z
    .array(
      z.object({
        key: keySchema,
        name: z.string().trim().min(3).max(120),
        owner: z.string().trim().min(2).max(80),
        note: z.string().trim().max(400).optional(),
        /** Items are also shown per programme (records with that programme). */
        perProgram: z.boolean().default(false),
        /** Institution profile fields shown in this block. */
        profile: z.array(z.enum(AISHE_PROFILE_FIELDS)).default([]),
        /** collegeOnly: a college-wide item in a per-programme block (not split by programme). */
        items: z.array(metricMeasureSchema.and(z.object({ collegeOnly: z.boolean().default(false) }))).max(20),
      }),
    )
    .min(1),
});
export type AisheSurvey = z.infer<typeof aisheSurveySchema>;

const fieldsSchema = z.array(z.string().min(1).max(40)).min(1).max(5);
const checkBase = { code: z.string().regex(/^[A-Z]{2}-[A-Z]{2,20}$/), level: z.enum(['error', 'check']), title: z.string().trim().min(5).max(160) };

export const aisheChecksSchema = z.object({
  version: z.string().trim().min(1).max(20),
  source: sourceSchema,
  checks: z
    .array(
      z.discriminatedUnion('kind', [
        /** Each record of a register: the left fields added up must not be more than the right fields added up. */
        z.object({ ...checkBase, kind: z.literal('record'), register: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/), left: fieldsSchema, right: fieldsSchema }),
        /** College totals for the year: left must not be more than right. */
        z.object({ ...checkBase, kind: z.literal('total'), left: metricMeasureSchema, right: metricMeasureSchema }),
        /** A figure that changed more than maxPercent since the year before. */
        z.object({ ...checkBase, kind: z.literal('change'), measure: metricMeasureSchema, maxPercent: z.number().min(1).max(1000) }),
        /** An institution profile field that must be entered (only for these college types, when given). */
        z.object({
          ...checkBase,
          kind: z.literal('profile'),
          field: z.enum(AISHE_PROFILE_FIELDS),
          only: z.array(z.enum(['affiliated', 'autonomous', 'university'])).optional(),
        }),
      ]),
    )
    .min(1),
  /** Figures colleges submit to several portals; compared with the registers and across portals. */
  figures: z.array(metricMeasureSchema.and(z.object({ portals: z.array(z.enum(SUBMISSION_PORTALS)).min(1) }))).min(1),
});
export type AisheChecks = z.infer<typeof aisheChecksSchema>;

/** What the college typed into a portal for one figure and year. A null value removes it. */
export const submittedFigureSchema = z.object({
  academicYearId: z.uuid(),
  portal: z.enum(SUBMISSION_PORTALS),
  key: keySchema,
  value: z.coerce.number({ error: 'Enter a number' }).min(0, 'Enter 0 or more').max(1e12).nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});
export type SubmittedFigureInput = z.infer<typeof submittedFigureSchema>;
