import { z } from 'zod';
import { isoDateSchema } from './setup.js';

/** File types faculty may upload, with their usual extensions. Anything else is refused. */
export const EVIDENCE_FILE_TYPES = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
} as const;
export type EvidenceFileType = keyof typeof EVIDENCE_FILE_TYPES;
export const EVIDENCE_FILE_TYPE_NAMES = 'PDF, JPG, PNG, WebP, Word, Excel or PowerPoint';

export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

/** Step 1: ask for an upload link. */
export const uploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(Object.keys(EVIDENCE_FILE_TYPES) as [EvidenceFileType, ...EvidenceFileType[]], {
    error: `Upload a ${EVIDENCE_FILE_TYPE_NAMES} file`,
  }),
  size: z
    .number()
    .int()
    .min(1, 'The file is empty')
    .max(MAX_EVIDENCE_BYTES, `Files can be up to ${MAX_EVIDENCE_BYTES / 1024 / 1024} MB`),
  /** SHA-256 of the file in hex, worked out in the browser. Only used to warn about duplicates. */
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullish(),
});
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

const details = {
  title: z.string().trim().min(3, 'Give the evidence a short title').max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((value) => value || null)
    .nullish(),
  documentDate: isoDateSchema.nullish(),
};

/** Step 2: after the file is uploaded, create the evidence. */
export const createEvidenceSchema = z.object({
  uploadToken: z.string().min(20),
  ...details,
  /** One of the uploader's departments. Left out: their first department, or none for college-wide roles. */
  departmentId: z.uuid().nullish(),
  /** The metric this is for (when uploading from a metric's page), and which of its documents. */
  metricId: z.uuid().nullish(),
  documentKey: z.string().max(40).nullish(),
  /** The task this upload is for (from the task's "Upload" button). */
  taskId: z.uuid().nullish(),
});
export type CreateEvidenceInput = z.input<typeof createEvidenceSchema>;

/** After "needs fix": a corrected file and/or corrected details. */
export const resubmitEvidenceSchema = z.object({
  uploadToken: z.string().min(20).nullish(),
  ...details,
});
export type ResubmitEvidenceInput = z.input<typeof resubmitEvidenceSchema>;

export const REVIEW_DECISIONS = ['approve', 'needs_fix', 'reject'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const reviewSchema = z
  .object({
    decision: z.enum(REVIEW_DECISIONS),
    comment: z
      .string()
      .trim()
      .max(1000)
      .transform((value) => value || null)
      .nullish(),
    /** The reviewer may correct the details while approving. */
    title: details.title.optional(),
    documentDate: isoDateSchema.nullish(),
  })
  .refine((review) => review.decision === 'approve' || review.comment, {
    message: 'Tell the uploader what to fix or why it is rejected',
    path: ['comment'],
  });
export type ReviewInput = z.input<typeof reviewSchema>;

export const FILE_KINDS = ['pdf', 'image', 'word', 'excel', 'powerpoint'] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const EVIDENCE_LIBRARY_STATUSES = ['in_review', 'department_approved', 'approved', 'needs_fix', 'rejected'] as const;

export const libraryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
  search: z.string().trim().max(100).optional(),
  yearId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  /** Comma-separated, e.g. "approved,in_review". */
  status: z
    .string()
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.enum(EVIDENCE_LIBRARY_STATUSES)))
    .optional(),
  metricId: z.uuid().optional(),
  /** "<frameworkId>:<criterion number>". */
  criterion: z
    .string()
    .regex(/^[0-9a-f-]{36}:\d{1,2}$/i)
    .optional(),
  kind: z.enum(FILE_KINDS).optional(),
  /** Only the person's own uploads. */
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type LibraryQuery = z.infer<typeof libraryQuerySchema>;

export const MAX_BULK_ITEMS = 200;

export const bulkLinkSchema = z.object({
  evidenceIds: z.array(z.uuid()).min(1).max(MAX_BULK_ITEMS),
  metricId: z.uuid(),
  documentKey: z.string().max(40).nullish(),
});
export type BulkLinkInput = z.infer<typeof bulkLinkSchema>;

export const bulkDownloadSchema = z.object({
  evidenceIds: z.array(z.uuid()).min(1).max(MAX_BULK_ITEMS),
});
export type BulkDownloadInput = z.infer<typeof bulkDownloadSchema>;
