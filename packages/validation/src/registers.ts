import { z } from 'zod';

// Data registers (decided 2026-10-17, docs/PRODUCT.md). A register's fields live in a versioned rules file
// (apps/api/rules/registers), so forms, tables, imports and checks are built from configuration, not code.

const key = z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/, 'Use camelCase letters and digits (e.g. "experienceYears")');

export const REGISTER_FIELD_TYPES = ['text', 'longtext', 'number', 'date', 'choice', 'boolean', 'url', 'program'] as const;
export type RegisterFieldType = (typeof REGISTER_FIELD_TYPES)[number];

export const registerFieldSchema = z
  .object({
    key,
    label: z.string().trim().min(2).max(80),
    type: z.enum(REGISTER_FIELD_TYPES),
    /** Needed for reports. A record can be saved without it, but it is counted as missing. */
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().default(false),
    /** Shown after the value, e.g. "years" or "₹ lakh". */
    unit: z.string().trim().max(20).optional(),
    help: z.string().trim().max(300).optional(),
    /** Shown as a column in the register table. */
    column: z.boolean().default(false),
  })
  .refine((f) => f.type !== 'choice' || (f.options?.length ?? 0) >= 2, { message: 'A choice field needs at least two options', path: ['options'] });
export type RegisterField = z.infer<typeof registerFieldSchema>;

export const registerDefinitionSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'e.g. FACULTY'),
    version: z.string().trim().min(1).max(20),
    name: z.string().trim().min(3).max(80),
    description: z.string().trim().min(3).max(300),
    status: z.enum(['draft', 'active', 'retired']),
    source: z.object({ title: z.string().trim().min(3).max(300), verified: z.boolean() }),
    /** Whether each record belongs to a department. */
    department: z.enum(['required', 'optional', 'none']),
    /** A record can be linked to a person in YuCampus; that person may then edit it ("own" permission). */
    person: z.object({ label: z.string().trim().min(2).max(60), required: z.boolean() }).nullish(),
    proof: z.enum(['none', 'optional', 'required']),
    /** At most one record per academic year (e.g. the college's yearly totals). */
    singlePerYear: z.boolean().default(false),
    /** The field that names a record in lists and messages. */
    titleField: key,
    fields: z.array(registerFieldSchema).min(1).max(60),
    /** Which reports use it, in words, e.g. "NAAC C3", "NIRF RP". Shown on the register page. */
    feeds: z.array(z.string().trim().min(2).max(40)).max(12).default([]),
    sortOrder: z.number().int().min(0).max(1000).default(100),
  })
  .refine((d) => new Set(d.fields.map((f) => f.key)).size === d.fields.length, { message: 'Field keys must be unique', path: ['fields'] })
  .refine((d) => d.fields.some((f) => f.key === d.titleField && ['text', 'longtext'].includes(f.type)), {
    message: 'titleField must name a text field',
    path: ['titleField'],
  });
export type RegisterDefinitionInput = z.infer<typeof registerDefinitionSchema>;

/** A stored value: strings, numbers, booleans and ISO dates. Empty means not filled in. */
export type RegisterValue = string | number | boolean | null;

const blank = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/** The validator for one field's value. Empty is always allowed here; `missingFields` reports it. */
export function registerValueSchema(field: Pick<RegisterField, 'type' | 'options' | 'min' | 'max' | 'integer' | 'label'>) {
  const optional = <T extends z.ZodType>(schema: T) =>
    z.preprocess((value) => (blank(value) ? null : typeof value === 'string' ? value.trim() : value), schema.nullable());
  switch (field.type) {
    case 'number': {
      let number = z.coerce.number({ error: `${field.label}: enter a number` });
      if (field.integer) number = number.int(`${field.label}: enter a whole number`);
      if (field.min !== undefined) number = number.min(field.min, `${field.label}: at least ${field.min}`);
      if (field.max !== undefined) number = number.max(field.max, `${field.label}: at most ${field.max}`);
      return optional(number);
    }
    case 'date':
      return optional(z.iso.date(`${field.label}: use a date like 2026-08-20`));
    case 'boolean':
      return optional(
        z.preprocess(
          (value) => (typeof value === 'string' ? ['yes', 'y', 'true', '1'].includes(value.toLowerCase()) : value),
          z.boolean({ error: `${field.label}: yes or no` }),
        ),
      );
    case 'choice': {
      const options = field.options ?? [];
      return optional(
        z.preprocess(
          // Imports may differ in case; store the option exactly as defined.
          (value) => (typeof value === 'string' ? (options.find((o) => o.toLowerCase() === value.toLowerCase()) ?? value) : value),
          z.string().refine((value) => options.includes(value), `${field.label}: choose one of ${options.join(', ')}`),
        ),
      );
    }
    case 'url':
      return optional(z.url(`${field.label}: enter a full web address starting with https://`).max(500));
    case 'program':
      return optional(z.uuid(`${field.label}: choose a program`));
    case 'longtext':
      return optional(z.string().max(5000, `${field.label}: at most 5000 characters`));
    default:
      return optional(z.string().max(500, `${field.label}: at most 500 characters`));
  }
}

/** The validator for a record's data. Unknown keys are dropped; the title field must be filled in. */
export function registerDataSchema(definition: Pick<RegisterDefinitionInput, 'fields' | 'titleField'>) {
  const shape = Object.fromEntries(definition.fields.map((field) => [field.key, registerValueSchema(field)]));
  const title = definition.fields.find((f) => f.key === definition.titleField);
  return z
    .object(shape)
    .refine((data) => !blank(data[definition.titleField]), { message: `Fill in ${title?.label ?? 'the name'}`, path: [definition.titleField] });
}

/** Required fields (and the person or department where those are required) that a record has not filled in. */
export function missingFields(
  definition: Pick<RegisterDefinitionInput, 'fields'>,
  data: Record<string, unknown>,
): string[] {
  return definition.fields.filter((f) => f.required && blank(data[f.key])).map((f) => f.key);
}

export const registerRecordSchema = z.object({
  academicYearId: z.uuid(),
  departmentId: z.uuid().nullish(),
  userId: z.uuid().nullish(),
  data: z.record(z.string(), z.unknown()),
  proofIds: z.array(z.uuid()).max(20).default([]),
});
export type RegisterRecordInput = z.input<typeof registerRecordSchema>;

export const registerQuerySchema = z.object({
  year: z.uuid().optional(),
  department: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  missing: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
export type RegisterQuery = z.infer<typeof registerQuerySchema>;

/** Rows from a spreadsheet, already mapped from column headings to field keys in the browser. */
export const registerImportSchema = z.object({
  academicYearId: z.uuid(),
  dryRun: z.boolean().default(true),
  rows: z
    .array(
      z.object({
        departmentCode: z.string().trim().max(20).nullish(),
        personEmail: z.string().trim().max(200).nullish(),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1, 'The sheet has no rows')
    .max(1000, 'Import at most 1000 rows at a time'),
});
export type RegisterImportInput = z.input<typeof registerImportSchema>;
