// NIRF data readiness (decided 2026-10-18). No score or rank: NIRF computes those itself.

export interface NirfItemView {
  key: string;
  label: string;
  register: string;
  unit?: string;
  /** One value per data year (oldest first); null when not entered. */
  values: (number | null)[];
}

export interface NirfSubParameterView {
  code: string;
  name: string;
  /** Who usually holds this data (a suggestion from the rules file). */
  owner: string;
  /** Share of its data items entered across the years; null when NIRF collects it itself (perception). */
  percent: number | null;
  items: NirfItemView[];
}

export interface NirfParameterView {
  key: string;
  name: string;
  /** Weight in percent for this category, where a checked value is known. */
  weight: number | null;
  note?: string;
  percent: number | null;
  subs: NirfSubParameterView[];
}

export interface NirfView {
  categories: { code: string; name: string }[];
  category: { code: string; name: string };
  years: { label: string; percent: number }[];
  parameters: NirfParameterView[];
  source: { title: string; verified: boolean };
  can: { assign: boolean };
}
