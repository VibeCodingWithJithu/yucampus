import type { AccreditationBody } from './index.js';

export type ReadinessStatus = 'on_track' | 'in_progress' | 'needs_attention';

export interface FrameworkRef {
  id: string;
  body: AccreditationBody;
  code: string;
  version: string;
  name: string;
  /** false: not checked against the official manual (e.g. demo data). Screens must say so clearly. */
  verified: boolean;
  sourceTitle: string;
}

export interface CriterionReadiness {
  number: number;
  name: string;
  /** No metrics loaded yet for this criterion ("loads from the final manual"). */
  pending: boolean;
  percent: number;
  status: ReadinessStatus;
  metricsComplete: number;
  metricsTotal: number;
  /** Approved evidence items counting towards it. */
  evidence: number;
  /** Required documents still without approved evidence. */
  missing: number;
}

export interface MetricAttention {
  metricId: string;
  code: string;
  name: string;
  criterionNumber: number;
  missing: string[];
  percent: number;
}

export interface AccreditationOverview {
  framework: FrameworkRef;
  /** The college's other active frameworks of this body (to switch between). */
  others: FrameworkRef[];
  cycle: { id: string; label: string } | null;
  academicYear: string | null;
  percent: number;
  status: ReadinessStatus;
  criteria: CriterionReadiness[];
  /** Metrics with documents still missing, emptiest first. */
  attention: MetricAttention[];
}

export interface MetricDocumentStatus {
  key: string;
  name: string;
  satisfied: boolean;
  /** Approved items for this document in the metric's years. */
  approved: number;
  /** Items linked but not yet finally approved. */
  pending: number;
}

export interface MetricEvidenceItem {
  id: string;
  title: string;
  status: string;
  stageLabel: string;
  documentKey: string | null;
  academicYear: string;
  uploadedBy: string;
  counts: boolean;
}

export interface MetricComment {
  id: string;
  by: string;
  body: string;
  at: string;
}

export interface MetricDetailView {
  id: string;
  code: string;
  name: string;
  plainLanguage: string;
  type: 'quantitative' | 'qualitative';
  yearsRequired: number;
  criterion: { number: number; name: string };
  framework: FrameworkRef;
  percent: number;
  status: ReadinessStatus;
  /** The academic years counted, newest first. */
  years: string[];
  documents: MetricDocumentStatus[];
  evidence: MetricEvidenceItem[];
  comments: MetricComment[];
  /** Numbers from the data registers, when the template maps this metric to them. */
  data: MetricDataView | null;
}

/**
 * A metric's inputs from the data registers, per academic year (oldest first). A value is null when the register
 * has no records at all that year ("not entered"), which is different from a counted zero.
 */
export interface MetricDataView {
  measures: { key: string; label: string; register: string; unit?: string }[];
  ratios: { label: string; format: 'percent' | 'per' }[];
  years: { label: string; values: (number | null)[]; ratios: (number | null)[] }[];
  note?: string;
}

/** A metric that evidence can be linked to (for pickers). */
export interface LinkableMetric {
  id: string;
  code: string;
  name: string;
  criterion: { number: number; name: string };
  framework: { id: string; body: AccreditationBody; name: string; verified: boolean };
  documents: { key: string; name: string }[];
}

/** A link shown on an evidence item. */
export interface EvidenceMetricLink {
  metricId: string;
  code: string;
  name: string;
  body: AccreditationBody;
  criterionNumber: number;
  documentKey: string | null;
  documentName: string | null;
}

export interface CriterionMetricRow {
  id: string;
  code: string;
  name: string;
  percent: number;
  status: ReadinessStatus;
  missing: string[];
  evidenceCount: number;
}

export interface CriterionView {
  framework: FrameworkRef;
  number: number;
  name: string;
  percent: number;
  status: ReadinessStatus;
  metrics: CriterionMetricRow[];
}
