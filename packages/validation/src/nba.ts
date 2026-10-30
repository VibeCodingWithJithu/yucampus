import { z } from 'zod';

// NBA outcomes (decided 2026-10-17). Totals per CO only: never individual students' marks.

const percent = z.number().min(0).max(100);

export const attainmentRulesSchema = z
  .object({
    targetMarkPercent: percent,
    levels: z.object({ level3: percent, level2: percent, level1: percent }),
    internalWeight: percent,
    endExamWeight: percent,
    directWeight: percent,
    indirectWeight: percent,
    coTarget: z.number().min(0).max(3),
  })
  .refine((r) => r.levels.level3 > r.levels.level2 && r.levels.level2 > r.levels.level1, {
    message: 'Level 3 needs a higher share than level 2, and level 2 than level 1',
    path: ['levels'],
  })
  .refine((r) => r.internalWeight + r.endExamWeight === 100, { message: 'Internal and end exam weights must add up to 100', path: ['endExamWeight'] })
  .refine((r) => r.directWeight + r.indirectWeight === 100, { message: 'Direct and indirect weights must add up to 100', path: ['indirectWeight'] });
export type AttainmentRulesInput = z.infer<typeof attainmentRulesSchema>;

export const courseInputSchema = z.object({
  academicYearId: z.uuid(),
  code: z.string().trim().min(1, 'Give the course code').max(20).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2, 'Give the course name').max(160),
  semester: z.coerce.number().int().min(1).max(12).nullish(),
  teacherId: z.uuid().nullish(),
});
export type CourseInput = z.input<typeof courseInputSchema>;

export const courseOutcomesSchema = z.object({
  outcomes: z
    .array(
      z.object({
        id: z.uuid().nullish(),
        code: z.string().trim().regex(/^CO\d{1,2}$/i, 'Use CO1, CO2 …').transform((v) => v.toUpperCase()),
        statement: z.string().trim().min(5, 'Write what students will be able to do').max(500),
        /** Course exit survey result on the 0–3 scale, until surveys fill it in. */
        indirectLevel: z.number().min(0).max(3).nullish(),
      }),
    )
    .max(12, 'At most 12 course outcomes')
    .refine((list) => new Set(list.map((o) => o.code)).size === list.length, 'Each CO code can be used once'),
});
export type CourseOutcomesInput = z.input<typeof courseOutcomesSchema>;

export const coPoMappingSchema = z.object({
  cells: z
    .array(z.object({ courseOutcomeId: z.uuid(), programOutcomeId: z.uuid(), strength: z.number().int().min(0).max(3) }))
    .max(12 * 30),
});
export type CoPoMappingInput = z.infer<typeof coPoMappingSchema>;

export const assessmentResultsSchema = z.object({
  results: z
    .array(
      z
        .object({
          courseOutcomeId: z.uuid(),
          kind: z.enum(['internal', 'end_exam']),
          name: z.string().trim().min(2, 'Name the assessment, e.g. Internal test 1').max(80),
          attempted: z.number().int().min(1, 'At least one student attempted').max(5000),
          reached: z.number().int().min(0).max(5000),
        })
        .refine((r) => r.reached <= r.attempted, { message: 'More students reached the target than attempted', path: ['reached'] }),
    )
    .max(12 * 10),
});
export type AssessmentResultsInput = z.infer<typeof assessmentResultsSchema>;

export const psosSchema = z.object({
  psos: z
    .array(
      z.object({
        id: z.uuid().nullish(),
        code: z.string().trim().regex(/^PSO\d{1,2}$/i, 'Use PSO1, PSO2 …').transform((v) => v.toUpperCase()),
        statement: z.string().trim().min(5).max(500),
      }),
    )
    .max(6, 'At most 6 program-specific outcomes')
    .refine((list) => new Set(list.map((o) => o.code)).size === list.length, 'Each PSO code can be used once'),
});
export type PsosInput = z.input<typeof psosSchema>;

/** Vision, mission and program educational objectives (SAR criterion 1). */
export const programProfileSchema = z.object({
  vision: z.string().trim().max(2000).default(''),
  mission: z.string().trim().max(3000).default(''),
  peos: z
    .array(
      z.object({
        code: z.string().trim().regex(/^PEO\d{1,2}$/i, 'Use PEO1, PEO2 …').transform((v) => v.toUpperCase()),
        statement: z.string().trim().min(5, 'Write the objective').max(500),
      }),
    )
    .max(8, 'At most 8 PEOs')
    .default([])
    .refine((list) => new Set(list.map((p) => p.code)).size === list.length, 'Each PEO code can be used once'),
});
export type ProgramProfileInput = z.input<typeof programProfileSchema>;
export type ProgramProfile = z.output<typeof programProfileSchema>;
