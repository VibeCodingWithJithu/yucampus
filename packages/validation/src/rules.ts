import { ACCREDITATION_BODIES, COLLEGE_TYPES } from '@yucampus/types';
import { z } from 'zod';

// The file format for criteria templates (CLAUDE.md rule 1: rules are configuration, never code).
// A template is loaded with `pnpm rules:import <file>`. See apps/api/rules/README.md.

const key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Use lowercase letters, digits, - or _ (e.g. "minutes")');

export const requiredDocumentSchema = z.object({
  key,
  name: z.string().trim().min(2).max(400),
});

/**
 * Where a metric's numbers come from in the data registers (decided 2026-10-17). Each measure counts or sums records
 * of one register per academic year, optionally filtered by field values; ratios divide one measure by another.
 * These are the inputs NAAC asks for, not NAAC's score.
 */
export const metricMeasureSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/),
    label: z.string().trim().min(3).max(120),
    register: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
    /** count records · sum fields · avg: average of a field over the records · value: the field of a one-a-year record. */
    op: z.enum(['count', 'sum', 'avg', 'value']),
    /** For sum, avg and value: the number field(s). A list adds several fields (e.g. placed + higher studies). */
    fields: z.array(z.string().min(1).max(40)).max(5).optional(),
    unit: z.string().trim().max(20).optional(),
    /** Only records whose field has one of these values, e.g. { "kind": ["Journal paper"], "ugcCare": [true] }. */
    where: z.record(z.string(), z.array(z.union([z.string(), z.boolean(), z.number()])).min(1).max(20)).default({}),
    /** Only records whose number field is at least this, e.g. { "fdpsThisYear": 1 }. */
    atLeast: z.record(z.string(), z.number()).default({}),
  })
  .refine((m) => m.op === 'count' || (m.fields?.length ?? 0) > 0, { message: 'A sum, average or value needs its fields', path: ['fields'] });

export const metricDataSchema = z
  .object({
    measures: z.array(metricMeasureSchema).min(1).max(6),
    ratios: z
      .array(
        z.object({
          label: z.string().trim().min(3).max(120),
          numerator: z.string(),
          denominator: z.string(),
          /** percent: 100 × a ÷ b · per: a ÷ b with two decimals. */
          format: z.enum(['percent', 'per']),
        }),
      )
      .max(4)
      .default([]),
    /** What else NAAC needs that the registers do not hold, said plainly. */
    note: z.string().trim().max(400).optional(),
  })
  .refine((d) => new Set(d.measures.map((m) => m.key)).size === d.measures.length, { message: 'Measure keys must be unique', path: ['measures'] })
  .refine((d) => d.ratios.every((r) => d.measures.some((m) => m.key === r.numerator) && d.measures.some((m) => m.key === r.denominator)), {
    message: 'Ratios must name measures of this metric',
    path: ['ratios'],
  });
export type MetricDataSource = z.infer<typeof metricDataSchema>;

export const templateMetricSchema = z.object({
  /** As printed in the manual, e.g. "3.3.1". */
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(3).max(600),
  /** What to collect, in words a non-technical teacher understands. */
  plainLanguage: z.string().trim().min(10).max(2000),
  type: z.enum(['quantitative', 'qualitative']),
  /** How many academic years of evidence the metric covers (e.g. 5 for the last five years). */
  yearsRequired: z.number().int().min(1).max(10),
  /** Marks (weightage) the manual gives this metric, if it gives any. */
  weight: z.number().int().min(0).max(1000).nullish(),
  requiredDocuments: z
    .array(requiredDocumentSchema)
    .min(1, 'List at least one document the metric needs')
    .refine((docs) => new Set(docs.map((d) => d.key)).size === docs.length, 'Document keys must be unique within a metric'),
  /** Numbers from the data registers, where the metric's wording can be met from them. */
  data: metricDataSchema.nullish(),
});

export const templateCriterionSchema = z.object({
  number: z.number().int().min(1).max(20),
  name: z.string().trim().min(3).max(200),
  /** Marks per institution type, as the manual gives them. Leave out if the manual has none. */
  weights: z.partialRecord(z.enum(COLLEGE_TYPES), z.number().min(0)).default({}),
  appliesTo: z.array(z.enum(COLLEGE_TYPES)).min(1).default([...COLLEGE_TYPES]),
  /** Empty means "criterion known, metrics not loaded yet"; the app says so instead of guessing. */
  metrics: z.array(templateMetricSchema).default([]),
});

/** A report the framework can produce (e.g. NAAC SSR and AQAR). Its layout version shows in the export history. */
export const templateReportSchema = z.object({
  kind: z.enum(['SSR', 'AQAR', 'SAR', 'NIRF_SHEET', 'AISHE']),
  version: z.string().trim().min(1).max(20),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(300),
  /** cycle: every year each metric needs (SSR) · year: one academic year, chosen when exporting (AQAR). */
  period: z.enum(['cycle', 'year']),
});
export type TemplateReport = z.infer<typeof templateReportSchema>;

export const rulesTemplateSchema = z
  .object({
    body: z.enum(ACCREDITATION_BODIES),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'e.g. NAAC_RAF'),
    version: z.string().trim().min(1).max(20),
    name: z.string().trim().min(3).max(200),
    selection: z.enum(['single', 'multiple']),
    attachesTo: z.enum(['college', 'program']),
    /** draft: being prepared · active: colleges can use it · retired: kept for old data only. */
    status: z.enum(['draft', 'active', 'retired']),
    validFrom: z.iso.date().nullish(),
    source: z.object({
      title: z.string().trim().min(3).max(300),
      url: z.url().nullish(),
      /** true only after someone has checked every line against the official manual. */
      verified: z.boolean(),
    }),
    criteria: z.array(templateCriterionSchema).min(1),
    reports: z.array(templateReportSchema).default([]),
  })
  .refine((t) => new Set(t.criteria.map((c) => c.number)).size === t.criteria.length, {
    message: 'Criterion numbers must be unique',
    path: ['criteria'],
  })
  .refine((t) => {
    const codes = t.criteria.flatMap((c) => c.metrics.map((m) => m.code));
    return new Set(codes).size === codes.length;
  }, { message: 'Metric codes must be unique within the template', path: ['criteria'] })
  .refine((t) => new Set(t.reports.map((r) => `${r.kind}:${r.version}`)).size === t.reports.length, {
    message: 'Each report kind and version can be listed once',
    path: ['reports'],
  })
  .refine((t) => t.status !== 'active' || t.source.verified, {
    message: 'Only a template checked against the official manual (source.verified = true) can be made active',
    path: ['status'],
  });
export type RulesTemplate = z.infer<typeof rulesTemplateSchema>;

/** Linking evidence to metrics (and, optionally, to which required document it is). */
export const evidenceMetricsSchema = z.object({
  links: z
    .array(z.object({ metricId: z.uuid(), documentKey: key.nullish() }))
    .max(10)
    .refine((links) => new Set(links.map((l) => l.metricId)).size === links.length, 'Each metric can be linked once'),
});
export type EvidenceMetricsInput = z.infer<typeof evidenceMetricsSchema>;

export const commentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment').max(2000) });
export type CommentInput = z.infer<typeof commentSchema>;

/** What a SAR criterion is compiled from in YuCampus; null = not compiled yet (said so in the report). */
export const SAR_SOURCES = ['profile', 'courses', 'outcomes', 'students', 'faculty', 'facilities'] as const;

/** The NBA SAR's structure (apps/api/rules/nba/sar.json): its criteria and which formats it serves. */
export const sarTemplateSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),
  version: z.string().trim().min(1).max(20),
  appliesTo: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/)).min(1),
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(300),
  source: z.object({ title: z.string().trim().min(3).max(300), verified: z.boolean() }),
  criteria: z
    .array(z.object({ number: z.number().int().min(1).max(20), name: z.string().trim().min(3).max(200), compiles: z.enum(SAR_SOURCES).nullable() }))
    .min(1)
    .max(20),
});
export type SarTemplate = z.infer<typeof sarTemplateSchema>;

/** NIRF parameters and what each sub-parameter needs (apps/api/rules/nirf/parameters.json). */
export const nirfTemplateSchema = z.object({
  version: z.string().trim().min(1).max(20),
  source: z.object({ title: z.string().trim().min(3).max(400), verified: z.boolean() }),
  /** Per NIRF category framework code: parameter weights in percent, or null where not checked. */
  categories: z.record(z.string().regex(/^NIRF_[A-Z_]+$/), z.object({ weights: z.record(z.string(), z.number().min(0).max(100)).nullable() })),
  parameters: z
    .array(
      z.object({
        key: z.string().regex(/^[A-Z]{2,4}$/),
        name: z.string().trim().min(3).max(120),
        note: z.string().trim().max(400).optional(),
        subs: z
          .array(
            z.object({
              code: z.string().regex(/^[A-Z]{2,6}$/),
              name: z.string().trim().min(3).max(160),
              owner: z.string().trim().min(2).max(80),
              items: z.array(metricMeasureSchema).max(10),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});
export type NirfTemplate = z.infer<typeof nirfTemplateSchema>;
