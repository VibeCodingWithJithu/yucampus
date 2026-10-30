import { z } from 'zod';

// Reports and export (slice 8). What each output contains is described by REPORT_OUTPUT_LABELS in @yucampus/types.

export const REPORT_OUTPUTS = ['report', 'index', 'pack', 'missing'] as const;

export const createExportSchema = z.object({
  templateId: z.uuid(),
  /** For a yearly report (AQAR): which academic year. Ignored for a whole-cycle report. */
  academicYearId: z.uuid().nullish(),
  /** For a per-program report (NBA SAR). */
  programId: z.uuid().nullish(),
  outputs: z
    .array(z.enum(REPORT_OUTPUTS))
    .min(1, 'Choose at least one file to create')
    .max(REPORT_OUTPUTS.length)
    .refine((outputs) => new Set(outputs).size === outputs.length, 'Each file can be chosen once'),
});
export type CreateExportInput = z.infer<typeof createExportSchema>;

export const reportChecksQuerySchema = z.object({
  template: z.uuid(),
  year: z.uuid().optional(),
  program: z.uuid().optional(),
});
export type ReportChecksQuery = z.infer<typeof reportChecksQuerySchema>;
