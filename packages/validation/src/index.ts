import { z } from 'zod';

export * from './auth.js';
export * from './evidence.js';
export * from './rules.js';
export * from './setup.js';
export * from './tasks.js';
export * from './reports.js';
export * from './registers.js';
export * from './nba.js';
export * from './surveys.js';
export * from './aishe.js';
export * from './audit.js';
export * from './platform.js';

export const MIN_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/** Query string for every list endpoint. */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(MIN_PAGE_SIZE),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;
