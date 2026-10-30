import type { PipeTransform } from '@nestjs/common';
import { ApiBody, type ApiBodyOptions } from '@nestjs/swagger';
import { z } from 'zod';
import { apiError } from './api-error.js';

/** Validates a request body with a shared Zod schema from @yucampus/validation. */
export class ZodPipe<Schema extends z.ZodType> implements PipeTransform<unknown, z.output<Schema>> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.output<Schema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw apiError(400, 'invalid_input', result.error.issues[0]?.message ?? 'Check what you entered and try again.');
  }
}

/** Documents a request body in OpenAPI straight from its Zod schema, so the two cannot drift apart. */
export function ApiZodBody(schema: z.ZodType) {
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
  return ApiBody({ schema: jsonSchema } as ApiBodyOptions);
}
