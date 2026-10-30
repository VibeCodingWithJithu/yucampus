import { type RegisterDefinitionInput, registerDefinitionSchema } from '@yucampus/validation';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { TemplateImportError } from './import-template.js';

export interface RegisterImportResult {
  definitionId: string;
  created: boolean;
  fields: number;
}

/** True for a rules file that describes a data register rather than criteria. */
export const isRegisterFile = (raw: unknown) => typeof raw === 'object' && raw !== null && 'fields' in raw && 'titleField' in raw;

/**
 * Loads a data register definition (apps/api/rules/registers) into the global rules table. Runs as the database owner.
 * Safe to run again. A version that colleges already hold records in only takes changes that keep those records
 * meaningful: fields can be added, but not removed or changed in type; anything else needs a new version.
 */
export async function importRegister(prisma: PrismaClient, raw: unknown): Promise<RegisterImportResult> {
  const parsed = registerDefinitionSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '(file)'}: ${issue.message}`).join('\n');
    throw new TemplateImportError(`The register definition is not valid:\n${issues}`);
  }
  const definition: RegisterDefinitionInput = parsed.data;

  return prisma.$transaction(async (db) => {
    const existing = await db.registerDefinition.findUnique({
      where: { code_version: { code: definition.code, version: definition.version } },
      include: { _count: { select: { records: true } } },
    });
    if (existing && existing._count.records > 0) {
      const before = (existing.definition as unknown as RegisterDefinitionInput).fields;
      const changed = before.filter((old) => {
        const now = definition.fields.find((f) => f.key === old.key);
        return !now || now.type !== old.type;
      });
      if (changed.length) {
        throw new TemplateImportError(
          `${definition.code} version ${definition.version} has records. These fields cannot be removed or change type: ` +
            `${changed.map((f) => f.key).join(', ')}. Publish a new version instead.`,
        );
      }
    }
    const data = {
      name: definition.name,
      status: definition.status,
      sortOrder: definition.sortOrder,
      definition: definition as unknown as Prisma.InputJsonObject,
    };
    const row = existing
      ? await db.registerDefinition.update({ where: { id: existing.id }, data })
      : await db.registerDefinition.create({ data: { ...data, code: definition.code, version: definition.version } });
    return { definitionId: row.id, created: !existing, fields: definition.fields.length };
  });
}
