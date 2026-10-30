// Data registers (decided 2026-10-17). Field lists come from configuration; these are the shapes the API returns.

export type RegisterFieldType = 'text' | 'longtext' | 'number' | 'date' | 'choice' | 'boolean' | 'url' | 'program';
export type RegisterValue = string | number | boolean | null;

export interface RegisterFieldView {
  key: string;
  label: string;
  type: RegisterFieldType;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  integer: boolean;
  unit?: string;
  help?: string;
  column: boolean;
}

export interface RegisterSummary {
  code: string;
  name: string;
  description: string;
  /** Which reports use it, e.g. "NAAC C3". */
  feeds: string[];
  verified: boolean;
  sourceTitle: string;
  /** Records the person can see in the chosen year, and how many of them are incomplete. */
  records: number;
  incomplete: number;
  /** import: bulk Excel import, for college and department editors (not for people who edit only their own). */
  can: { add: boolean; import: boolean };
}

export interface RegisterDefinitionView extends RegisterSummary {
  id: string;
  version: string;
  department: 'required' | 'optional' | 'none';
  person: { label: string; required: boolean } | null;
  proof: 'none' | 'optional' | 'required';
  singlePerYear: boolean;
  titleField: string;
  fields: RegisterFieldView[];
}

export interface RegisterProof {
  id: string;
  title: string;
}

export interface RegisterRecordView {
  id: string;
  title: string;
  data: Record<string, RegisterValue>;
  department: { id: string; code: string } | null;
  person: { id: string; name: string } | null;
  proofs: RegisterProof[];
  /** Keys of required fields not filled in; "proof" when proof is required and none is linked. */
  missing: string[];
  updatedAt: string;
  updatedBy: string;
  can: { edit: boolean };
}

export interface RegisterPage {
  definition: RegisterDefinitionView;
  year: { id: string; label: string; locked: boolean };
  items: RegisterRecordView[];
  total: number;
  incomplete: number;
  /** For program fields and the person picker. */
  programs: { id: string; name: string; departmentId: string }[];
  people: { id: string; name: string }[];
  /** An earlier year with records to copy from, when this year has none yet. */
  copyFrom: { id: string; label: string; records: number } | null;
}

export interface RegisterImportProblem {
  row: number;
  message: string;
}

export interface RegisterImportResult {
  created: number;
  problems: RegisterImportProblem[];
  saved: boolean;
}
