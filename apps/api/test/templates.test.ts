// Guards the criteria templates in apps/api/rules. The expected numbers are the ones each NAAC manual states
// in its own "Table 1" and weightage table, so a bad edit or extraction fails here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type RulesTemplate, rulesTemplateSchema } from '@yucampus/validation';
import { describe, expect, it } from 'vitest';

const RULES = path.resolve(import.meta.dirname, '../rules');
const load = (file: string): RulesTemplate => rulesTemplateSchema.parse(JSON.parse(readFileSync(path.join(RULES, file), 'utf8')));

const NAAC = [
  { file: 'naac-raf-affiliated.json', type: 'affiliated', qualitative: 22, quantitative: 34 },
  { file: 'naac-raf-autonomous.json', type: 'autonomous', qualitative: 35, quantitative: 50 },
  { file: 'naac-raf-university.json', type: 'university', qualitative: 32, quantitative: 55 },
] as const;

describe.each(NAAC)('$file', ({ file, type, qualitative, quantitative }) => {
  const template = load(file);
  const metrics = template.criteria.flatMap((criterion) => criterion.metrics);

  it('has the seven RAF criteria, for its institution type only', () => {
    expect(template.criteria.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(template.criteria.every((c) => c.appliesTo.length === 1 && c.appliesTo[0] === type)).toBe(true);
  });

  it('has the number of qualitative and quantitative metrics the manual states', () => {
    expect(metrics.filter((m) => m.type === 'qualitative')).toHaveLength(qualitative);
    expect(metrics.filter((m) => m.type === 'quantitative')).toHaveLength(quantitative);
  });

  it('has metric marks that add up to each criterion’s marks, and 1,000 in all', () => {
    for (const criterion of template.criteria) {
      const sum = criterion.metrics.reduce((total, m) => total + (m.weight ?? 0), 0);
      expect(sum, `criterion ${criterion.number}`).toBe(criterion.weights[type]);
    }
    expect(template.criteria.reduce((total, c) => total + (c.weights[type] ?? 0), 0)).toBe(1000);
  });

  it('gives every metric a code under its criterion, at least one document, and nothing from outside the metric', () => {
    for (const criterion of template.criteria) {
      for (const metric of criterion.metrics) {
        expect(metric.code.startsWith(`${criterion.number}.`), metric.code).toBe(true);
        expect(metric.requiredDocuments.length, metric.code).toBeGreaterThan(0);
        expect(metric.requiredDocuments.length, metric.code).toBeLessThanOrEqual(10);
        expect(metric.plainLanguage.length, metric.code).toBeLessThan(1000);
      }
    }
  });

  it('is marked as not yet checked line by line, so the app warns about it', () => {
    expect(template.source.verified).toBe(false);
    expect(template.status).toBe('draft');
  });
});
