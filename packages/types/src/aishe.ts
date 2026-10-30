// AISHE data forms and the consistency checker (decided 2026-10-18). Inputs from the registers; nothing is sent to AISHE.

export interface AisheItemView {
  key: string;
  label: string;
  register: string;
  unit?: string;
  /** The year before, then the survey year; null when not entered. */
  values: (number | null)[];
}

export interface AisheProgramRow {
  id: string;
  name: string;
  level: string;
  /** Survey year values, one per item in `itemKeys` order; null when not entered. */
  values: (number | null)[];
}

export interface AisheProfileItem {
  key: string;
  label: string;
  value: string | null;
}

export interface AisheBlockView {
  key: string;
  name: string;
  owner: string;
  note?: string;
  /** Share of the survey year's items (and profile fields) entered. */
  percent: number;
  profile: AisheProfileItem[];
  items: AisheItemView[];
  /** For a per-programme block: the item keys split by programme, and one row per programme. */
  perProgram: { itemKeys: string[]; rows: AisheProgramRow[] } | null;
}

export type AisheLevel = 'error' | 'check';

export interface AisheFinding {
  code: string;
  level: AisheLevel;
  title: string;
  /** The figures behind it, in plain words. */
  detail: string;
  /** Where to fix it, e.g. { label: 'Student batches', href: '/registers?register=STUDENT_BATCHES' }. */
  fix: { label: string; href: string };
}

export interface AisheFigureView {
  key: string;
  label: string;
  unit?: string;
  portals: ('AISHE' | 'NIRF' | 'NAAC')[];
  /** From the registers for the survey year. */
  registers: number | null;
  submitted: { portal: 'AISHE' | 'NIRF' | 'NAAC'; value: number; note: string | null; updatedAt: string }[];
}

export interface AisheView {
  /** Academic years that have started, newest first. */
  years: { id: string; label: string; status: string }[];
  year: { id: string; label: string };
  previousYear: { id: string; label: string } | null;
  percent: number;
  blocks: AisheBlockView[];
  checks: { findings: AisheFinding[]; errors: number; warnings: number; passed: number; total: number };
  figures: AisheFigureView[];
  source: { title: string; verified: boolean };
  checksSource: { title: string; verified: boolean };
  can: { assign: boolean; recordSubmitted: boolean };
}
