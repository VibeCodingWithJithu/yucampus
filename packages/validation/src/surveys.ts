import { z } from 'zod';
import { isoDateSchema } from './setup.js';

// Surveys (decided 2026-10-17). Anonymous answers through an open link or QR code; no respondent lists.

export const surveyTemplatesSchema = z.object({
  version: z.string().trim().min(1).max(20),
  source: z.object({ title: z.string().trim().min(3).max(400), verified: z.boolean() }),
  templates: z
    .array(
      z.object({
        code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
        name: z.string().trim().min(3).max(80),
        audience: z.string().trim().min(3).max(60),
        description: z.string().trim().min(3).max(300),
        feeds: z.array(z.string().trim().min(2).max(60)).max(6).default([]),
        scale: z.union([z.literal(3), z.literal(5)]),
        /** One rating question per course outcome is added for the chosen course (course exit). */
        perCourse: z.boolean().default(false),
        questions: z.array(z.object({ kind: z.enum(['rating', 'comment']), text: z.string().trim().min(5).max(300) })).max(40),
      }),
    )
    .min(1),
});
export type SurveyTemplates = z.infer<typeof surveyTemplatesSchema>;

export const createSurveySchema = z.object({
  templateCode: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  title: z.string().trim().min(3, 'Give the survey a title').max(160),
  academicYearId: z.uuid(),
  /** For a course exit survey. */
  courseId: z.uuid().nullish(),
  /** How many people are expected to answer (e.g. the class strength), for the response rate. */
  expectedResponses: z.coerce.number().int().min(1).max(100000).nullish(),
  closesOn: isoDateSchema.nullish(),
});
export type CreateSurveyInput = z.input<typeof createSurveySchema>;

export const surveyStatusSchema = z.object({ status: z.enum(['open', 'closed']) });

/** A public answer. The device token stops one device answering twice; it is stored only as a hash. */
export const surveyAnswersSchema = z.object({
  deviceToken: z.string().min(16).max(100),
  answers: z
    .array(
      z.object({
        questionId: z.uuid(),
        rating: z.number().int().min(1).max(5).nullish(),
        comment: z.string().trim().max(2000).nullish(),
      }),
    )
    .min(1, 'Answer at least one question')
    .max(80),
});
export type SurveyAnswersInput = z.infer<typeof surveyAnswersSchema>;
