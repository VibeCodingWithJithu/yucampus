import { describe, expect, it } from 'vitest';
import { type ApprovedLink, type MetricFacts, average, metricReadiness, statusFor, yearsWindow } from './readiness.js';

const years = [
  { id: 'y2023', startDate: new Date('2023-07-01'), status: 'locked' as const },
  { id: 'y2024', startDate: new Date('2024-07-01'), status: 'locked' as const },
  { id: 'y2025', startDate: new Date('2025-07-01'), status: 'locked' as const },
  { id: 'y2026', startDate: new Date('2026-07-01'), status: 'current' as const },
  { id: 'y2027', startDate: new Date('2027-07-01'), status: 'next' as const },
];

const twoDocs: MetricFacts = {
  id: 'm1',
  code: 'D3.1',
  name: 'Papers',
  criterionNumber: 3,
  yearsRequired: 2,
  weight: 10,
  requiredDocuments: [
    { key: 'first-page', name: 'First page' },
    { key: 'journal-proof', name: 'Journal proof' },
  ],
};
const oneDoc: MetricFacts = { ...twoDocs, id: 'm2', requiredDocuments: [{ key: 'minutes', name: 'Minutes' }] };
const link = (overrides: Partial<ApprovedLink>): ApprovedLink => ({
  evidenceId: 'e1',
  metricId: 'm1',
  documentKey: 'first-page',
  academicYearId: 'y2026',
  ...overrides,
});

describe('yearsWindow', () => {
  it('takes the current year and the years before it, never the next year', () => {
    expect([...yearsWindow(years, 2)]).toEqual(['y2026', 'y2025']);
    expect([...yearsWindow(years, 10)]).toEqual(['y2026', 'y2025', 'y2024', 'y2023']);
  });

  it('is empty when there is no current year', () => {
    expect(yearsWindow(years.filter((y) => y.status !== 'current'), 5).size).toBe(0);
  });
});

describe('metricReadiness', () => {
  const window = yearsWindow(years, 2);

  it('is the share of required documents that have approved evidence', () => {
    expect(metricReadiness(twoDocs, [], window)).toMatchObject({ percent: 0, evidenceCount: 0 });
    const half = metricReadiness(twoDocs, [link({})], window);
    expect(half).toMatchObject({ percent: 50, satisfied: ['first-page'], evidenceCount: 1 });
    expect(half.missing.map((d) => d.key)).toEqual(['journal-proof']);
    const full = metricReadiness(twoDocs, [link({}), link({ evidenceId: 'e2', documentKey: 'journal-proof' })], window);
    expect(full).toMatchObject({ percent: 100, missing: [], evidenceCount: 2 });
  });

  it('ignores evidence from years outside the metric’s window', () => {
    expect(metricReadiness(twoDocs, [link({ academicYearId: 'y2023' })], window).percent).toBe(0);
  });

  it('counts several items for one document once', () => {
    const r = metricReadiness(twoDocs, [link({}), link({ evidenceId: 'e2' })], window);
    expect(r).toMatchObject({ percent: 50, evidenceCount: 2 });
  });

  it('lets a link without a document count only when the metric has a single document', () => {
    expect(metricReadiness(oneDoc, [link({ metricId: 'm2', documentKey: null })], window).percent).toBe(100);
    expect(metricReadiness(twoDocs, [link({ documentKey: null })], window).percent).toBe(0);
  });

  it('ignores links to other metrics and unknown document keys', () => {
    expect(metricReadiness(twoDocs, [link({ metricId: 'other' }), link({ documentKey: 'nope' })], window).percent).toBe(0);
  });
});

describe('statusFor and average', () => {
  it('uses the design’s thresholds', () => {
    expect(statusFor(100)).toBe('on_track');
    expect(statusFor(75)).toBe('on_track');
    expect(statusFor(74)).toBe('in_progress');
    expect(statusFor(60)).toBe('in_progress');
    expect(statusFor(59)).toBe('needs_attention');
  });

  it('averages, with weights when every weight is given', () => {
    expect(average([])).toBe(0);
    expect(average([100, 0])).toBe(50);
    expect(average([100, 0], [3, 1])).toBe(75);
    expect(average([100, 0], [3, 0])).toBe(50);
  });
});
