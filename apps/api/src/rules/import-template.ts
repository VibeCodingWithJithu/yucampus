import { type RulesTemplate, rulesTemplateSchema } from '@yucampus/validation';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';

export interface ImportResult {
  frameworkId: string;
  created: boolean;
  criteria: number;
  metrics: number;
}

export class TemplateImportError extends Error {}

/**
 * Loads a criteria template (CLAUDE.md rule 1) into the global rules tables. Runs as the database owner
 * (rules are read-only for the app). Safe to run again: it updates in place.
 *
 * Guard rails:
 * - an "active" version is never changed in place; publish a new version instead, so evidence collected
 *   against the old wording keeps its meaning;
 * - a metric that has evidence linked to it is never deleted.
 */
export async function importTemplate(prisma: PrismaClient, raw: unknown): Promise<ImportResult> {
  const parsed = rulesTemplateSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '(file)'}: ${issue.message}`).join('\n');
    throw new TemplateImportError(`The template is not valid:\n${issues}`);
  }
  const template: RulesTemplate = parsed.data;

  return prisma.$transaction(async (db) => {
    const existing = await db.framework.findUnique({ where: { code_version: { code: template.code, version: template.version } } });
    if (existing?.status === 'active') {
      throw new TemplateImportError(
        `${template.code} version ${template.version} is active and in use. Publish the changes as a new version instead.`,
      );
    }

    const data = {
      body: template.body,
      name: template.name,
      selection: template.selection,
      attachesTo: template.attachesTo,
      status: template.status,
      validFrom: template.validFrom ? new Date(`${template.validFrom}T00:00:00Z`) : null,
      source: template.source as Prisma.InputJsonObject,
    };
    const framework = existing
      ? await db.framework.update({ where: { id: existing.id }, data })
      : await db.framework.create({ data: { ...data, code: template.code, version: template.version } });

    let metricCount = 0;
    const keptCriteria: string[] = [];
    for (const criterion of template.criteria) {
      const row = await db.criterion.upsert({
        where: { frameworkId_number: { frameworkId: framework.id, number: criterion.number } },
        update: { name: criterion.name, weights: criterion.weights, appliesToInstitutionTypes: criterion.appliesTo },
        create: {
          frameworkId: framework.id,
          number: criterion.number,
          name: criterion.name,
          weights: criterion.weights,
          appliesToInstitutionTypes: criterion.appliesTo,
        },
      });
      keptCriteria.push(row.id);

      const keptCodes: string[] = [];
      for (const [index, metric] of criterion.metrics.entries()) {
        const fields = {
          name: metric.name,
          plainLanguage: metric.plainLanguage,
          type: metric.type,
          yearsRequired: metric.yearsRequired,
          weight: metric.weight ?? null,
          requiredDocuments: metric.requiredDocuments as Prisma.InputJsonArray,
          dataSource: metric.data ? (metric.data as Prisma.InputJsonObject) : Prisma.DbNull,
          sortOrder: index,
        };
        await db.metric.upsert({
          where: { criterionId_code: { criterionId: row.id, code: metric.code } },
          update: fields,
          create: { ...fields, criterionId: row.id, code: metric.code },
        });
        keptCodes.push(metric.code);
        metricCount++;
      }
      await removeMetrics(db, { criterionId: row.id, code: { notIn: keptCodes } });
    }

    const dropped = await db.criterion.findMany({ where: { frameworkId: framework.id, id: { notIn: keptCriteria } }, select: { id: true } });
    for (const { id } of dropped) {
      await removeMetrics(db, { criterionId: id });
      await db.criterion.delete({ where: { id } });
    }

    // Report layouts. One that past exports point to is kept even if the file no longer lists it.
    const keptReports: string[] = [];
    for (const report of template.reports) {
      const layout = { name: report.name, description: report.description, period: report.period };
      const row = await db.reportTemplate.upsert({
        where: { frameworkId_kind_version: { frameworkId: framework.id, kind: report.kind, version: report.version } },
        update: { layout },
        create: { frameworkId: framework.id, kind: report.kind, version: report.version, layout },
      });
      keptReports.push(row.id);
    }
    await db.reportTemplate.deleteMany({ where: { frameworkId: framework.id, id: { notIn: keptReports }, exportJobs: { none: {} } } });

    return { frameworkId: framework.id, created: !existing, criteria: template.criteria.length, metrics: metricCount };
  });
}

async function removeMetrics(db: Prisma.TransactionClient, where: Prisma.MetricWhereInput) {
  const metrics = await db.metric.findMany({ where, select: { id: true, code: true, _count: { select: { evidence: true } } } });
  const inUse = metrics.filter((metric) => metric._count.evidence > 0);
  if (inUse.length) {
    throw new TemplateImportError(
      `These metrics have evidence linked and cannot be removed: ${inUse.map((m) => m.code).join(', ')}. Publish a new version instead.`,
    );
  }
  if (metrics.length) await db.metric.deleteMany({ where: { id: { in: metrics.map((m) => m.id) } } });
}
