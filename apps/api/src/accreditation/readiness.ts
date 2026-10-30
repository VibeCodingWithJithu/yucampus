// How ready a college is, worked out only from finally approved evidence (CLAUDE.md rule 3: AI suggestions
// and unapproved uploads never count). Plain functions so the rules can be tested on their own.

export interface RequiredDocument {
  key: string;
  name: string;
}

export interface MetricFacts {
  id: string;
  code: string;
  name: string;
  criterionNumber: number;
  yearsRequired: number;
  /** Marks the manual gives the metric; criterion readiness is weighted by them when every metric has some. */
  weight: number | null;
  requiredDocuments: RequiredDocument[];
}

/** One link between an approved evidence item and a metric. */
export interface ApprovedLink {
  evidenceId: string;
  metricId: string;
  documentKey: string | null;
  academicYearId: string;
}

export interface MetricReadiness {
  metricId: string;
  percent: number;
  /** Required documents with at least one approved item in the metric's years. */
  satisfied: string[];
  missing: RequiredDocument[];
  /** Approved evidence items that count for this metric. */
  evidenceCount: number;
}

export type ReadinessStatus = 'on_track' | 'in_progress' | 'needs_attention';

/** The thresholds in the NAAC criteria design: 75% and above on track, 60-74% in progress. */
export function statusFor(percent: number): ReadinessStatus {
  if (percent >= 75) return 'on_track';
  return percent >= 60 ? 'in_progress' : 'needs_attention';
}

/**
 * The academic years a metric covers: the current year and the years before it, newest first,
 * `yearsRequired` in all. Years that have not started (next) never count.
 */
export function yearsWindow(
  years: readonly { id: string; startDate: Date; status: 'current' | 'locked' | 'next' }[],
  yearsRequired: number,
): Set<string> {
  const current = years.find((year) => year.status === 'current');
  if (!current) return new Set();
  return new Set(
    years
      .filter((year) => year.status !== 'next' && year.startDate <= current.startDate)
      .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
      .slice(0, yearsRequired)
      .map((year) => year.id),
  );
}

export function metricReadiness(metric: MetricFacts, links: readonly ApprovedLink[], window: Set<string>): MetricReadiness {
  const counted = links.filter((link) => link.metricId === metric.id && window.has(link.academicYearId));
  const keys = new Set(metric.requiredDocuments.map((doc) => doc.key));
  // A link without a document key counts for the metric's only document, if it has just one.
  const only = metric.requiredDocuments.length === 1 ? metric.requiredDocuments[0]!.key : null;
  const covered = new Set(
    counted.map((link) => link.documentKey ?? only).filter((key): key is string => key !== null && keys.has(key)),
  );
  const satisfied = metric.requiredDocuments.filter((doc) => covered.has(doc.key)).map((doc) => doc.key);
  const total = metric.requiredDocuments.length;
  return {
    metricId: metric.id,
    percent: total === 0 ? 0 : Math.round((satisfied.length / total) * 100),
    satisfied,
    missing: metric.requiredDocuments.filter((doc) => !covered.has(doc.key)),
    evidenceCount: new Set(counted.map((link) => link.evidenceId)).size,
  };
}

/** Average of numbers, 0 when there are none; rounded to a whole percent. */
export function average(values: readonly number[], weights?: readonly number[]): number {
  if (values.length === 0) return 0;
  const w = weights && weights.length === values.length && weights.every((x) => x > 0) ? weights : values.map(() => 1);
  const total = w.reduce((sum, x) => sum + x, 0);
  return Math.round(values.reduce((sum, value, index) => sum + value * w[index]!, 0) / total);
}
