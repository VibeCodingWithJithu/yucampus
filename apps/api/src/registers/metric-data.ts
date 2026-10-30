// A metric's numbers from the data registers (decided 2026-10-17). The template says which records to count or add up
// (metricDataSchema); this works them out per academic year. Inputs only: NAAC applies its own formula.

import type { MetricDataView } from '@yucampus/types';
import { type MetricDataSource, metricDataSchema } from '@yucampus/validation';
import type { TenantClient } from '../prisma/prisma.service.js';

export interface MetricDataYear {
  id: string;
  label: string;
}

const yearLabel = (label: string) => label.replace('-', '–');

function matches(data: Record<string, unknown>, where: Record<string, (string | boolean | number)[]>) {
  return Object.entries(where).every(([field, values]) => {
    const value = data[field];
    return values.some((wanted) => (typeof wanted === 'string' && typeof value === 'string' ? wanted.toLowerCase() === value.toLowerCase() : wanted === value));
  });
}

/** Reads a stored data source, ignoring one that does not match the current format (shown as no data, never guessed). */
export function parseDataSource(raw: unknown): MetricDataSource | null {
  if (!raw) return null;
  const parsed = metricDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Counts and sums per year. `years` decides the columns (oldest first). With `departmentIds`, only records of those
 * departments count (a HOD's report). A register without any record in a year gives null for that year.
 */
export async function metricData(
  db: TenantClient,
  collegeId: string,
  source: MetricDataSource,
  years: readonly MetricDataYear[],
  departmentIds?: readonly string[] | null,
): Promise<MetricDataView> {
  const codes = [...new Set(source.measures.map((m) => m.register))];
  // Every version of a register counts: records stay with the version they were entered in.
  const definitions = await db.registerDefinition.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
  const codeOf = new Map(definitions.map((d) => [d.id, d.code]));
  const records = await db.registerRecord.findMany({
    where: {
      collegeId,
      definitionId: { in: definitions.map((d) => d.id) },
      academicYearId: { in: years.map((y) => y.id) },
      ...(departmentIds?.length ? { departmentId: { in: [...departmentIds] } } : {}),
    },
    select: { definitionId: true, academicYearId: true, data: true },
  });

  return {
    measures: source.measures.map((m) => ({ key: m.key, label: m.label, register: m.register, ...(m.unit ? { unit: m.unit } : {}) })),
    ratios: source.ratios.map((r) => ({ label: r.label, format: r.format })),
    years: years.map((year) => {
      const values = source.measures.map((measure) => {
        const inRegister = records.filter((r) => r.academicYearId === year.id && codeOf.get(r.definitionId) === measure.register);
        if (inRegister.length === 0) return null;
        const counted = inRegister.filter((r) => {
          const data = (r.data ?? {}) as Record<string, unknown>;
          return (
            matches(data, measure.where) &&
            Object.entries(measure.atLeast).every(([field, min]) => typeof data[field] === 'number' && (data[field] as number) >= min)
          );
        });
        if (measure.op === 'count') return counted.length;
        // Numbers of the counted records; a record that leaves every field empty adds nothing.
        const numbers = counted
          .map((r) => {
            const data = (r.data ?? {}) as Record<string, unknown>;
            const values = (measure.fields ?? []).map((f) => data[f]).map((v) => (typeof v === 'boolean' ? Number(v) : v));
            return values.some((v) => typeof v === 'number') ? values.reduce((sum: number, v) => sum + (typeof v === 'number' ? v : 0), 0) : null;
          })
          .filter((v): v is number => v !== null);
        if (counted.length && numbers.length === 0) return null; // Records exist but the field is not filled in.
        if (measure.op === 'avg') return numbers.length ? Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 100) / 100 : null;
        if (measure.op === 'value') return numbers[0] ?? null;
        return Math.round(numbers.reduce((a, b) => a + b, 0) * 100) / 100;
      });
      const valueOf = (key: string) => values[source.measures.findIndex((m) => m.key === key)] ?? null;
      const ratios = source.ratios.map((ratio) => {
        const a = valueOf(ratio.numerator);
        const b = valueOf(ratio.denominator);
        if (a === null || b === null || b === 0) return null;
        return ratio.format === 'percent' ? Math.round((a / b) * 1000) / 10 : Math.round((a / b) * 100) / 100;
      });
      return { label: yearLabel(year.label), values, ratios };
    }),
    ...(source.note ? { note: source.note } : {}),
  };
}
