import { Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import { apiError } from './api-error.js';
import { ZodPipe } from './zod.js';

const idSchema = z.uuid('That link is not valid.');

/** A route id. Anything that is not a UUID is refused before it reaches the database. */
export const IdParam = (name = 'id') => Param(name, new ZodPipe(idSchema));

/** Query string validated with a shared Zod schema. */
export const ZodQuery = (schema: z.ZodType) => Query(new ZodPipe(schema));

export const notFound = (what: string) => apiError(404, 'not_found', `We could not find that ${what}.`);

/** True when the database refused a duplicate value (a unique index). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Date column (YYYY-MM-DD at midnight UTC) to and from the API's date strings. */
export const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);
export const fromIsoDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
