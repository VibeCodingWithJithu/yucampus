/** Files an export can create. Each output is one or two files. */
export type ReportOutput = 'report' | 'index' | 'pack' | 'missing';

export const REPORT_OUTPUT_LABELS: Record<ReportOutput, { name: string; info: string }> = {
  report: {
    name: 'Full report (Word and PDF)',
    info: 'Criteria and metrics in order, with readiness and the approved evidence for each document. For sign-off and the peer team.',
  },
  index: {
    name: 'Evidence index (Excel)',
    info: 'Every approved document by criterion and metric, with its file name in the pack. Useful for DVV.',
  },
  pack: {
    name: 'Evidence pack (ZIP)',
    info: 'Approved files in folders by criterion and metric, with clear file names and the index.',
  },
  missing: {
    name: 'Missing items list (Excel)',
    info: 'Documents still without approved evidence, with the open task and who it is with.',
  },
};

export interface ReportTemplateView {
  id: string;
  kind: 'SSR' | 'AQAR' | 'SAR' | 'NIRF_SHEET' | 'AISHE';
  name: string;
  description: string;
  period: 'cycle' | 'year';
  version: string;
  framework: { id: string; name: string; verified: boolean };
  /** For a per-program report (NBA SAR): the program it is for. */
  program: { id: string; name: string } | null;
  /** The files this report can create (a SAR has no evidence pack yet). */
  outputs: ReportOutput[];
}

/** "Fix before export": must = the report will show gaps; check = worth a look before submitting. */
export interface ReportIssue {
  level: 'must' | 'check';
  text: string;
  link: string | null;
}

export interface ReportChecks {
  issues: ReportIssue[];
  /** One sentence on how complete the report is. */
  summary: string;
  /** Required documents with approved evidence in the period, and those without. */
  covered: number;
  missing: number;
}

export type ExportStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ExportFileView {
  index: number;
  name: string;
  kind: 'docx' | 'pdf' | 'xlsx' | 'zip';
  size: number;
}

export interface ExportView {
  id: string;
  /** e.g. "NAAC AQAR 2026–27" */
  label: string;
  /** e.g. "NAAC RAF · Affiliated colleges, layout 1" */
  formatVersion: string;
  outputs: ReportOutput[];
  status: ExportStatus;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
  files: ExportFileView[];
  error: string | null;
}
