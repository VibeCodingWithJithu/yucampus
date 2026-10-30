import { z } from 'zod';
import { isoDateSchema } from './setup.js';

/** Filters of the audit log page and its CSV download. Dates are India dates, both ends included. */
export const auditQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(30),
    userId: z.uuid().optional(),
    entity: z.string().regex(/^[a-z_]{2,40}$/).optional(),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'The start date must be on or before the end date', path: ['to'] });
export type AuditQuery = z.infer<typeof auditQuerySchema>;
