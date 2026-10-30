import type { EvidenceMetricLink } from './accreditation.js';
import type { EvidenceStatus } from './index.js';

/** Returned when asking to upload: where to send the file, and a token to present afterwards. */
export interface UploadTicket {
  url: string;
  method: 'PUT';
  /** Send exactly these headers with the file; they are part of the signature. */
  headers: Record<string, string>;
  /** Proves to the API which upload this was. Valid for a short time. */
  uploadToken: string;
  expiresAt: string;
}

export type ReviewLevel = 'department' | 'final';

/** Where an item is in approval, in plain words for the screen. */
export interface EvidenceStage {
  status: EvidenceStatus;
  /** Which approval it is waiting for, if any. */
  waitingFor: ReviewLevel | null;
  label: string;
}

export interface EvidenceSummary {
  id: string;
  title: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: EvidenceStatus;
  stage: EvidenceStage;
  version: number;
  uploadedAt: string;
  updatedAt: string;
  uploadedBy: { id: string; name: string };
  department: { id: string; code: string } | null;
  academicYear: string;
}

export interface ReviewHistoryEntry {
  action: 'submitted' | 'resubmitted' | 'approved' | 'needs_fix' | 'rejected' | 'remapped';
  level: ReviewLevel | null;
  by: string;
  comment: string | null;
  at: string;
}

/** An automatic check shown to the reviewer. Never decides anything by itself. */
export interface EvidenceCheck {
  key: 'duplicate' | 'date' | 'file';
  ok: boolean;
  text: string;
}

export interface EvidenceDetail extends EvidenceSummary {
  description: string | null;
  documentDate: string | null;
  history: ReviewHistoryEntry[];
  checks: EvidenceCheck[];
  /** The metrics this evidence counts for once finally approved. */
  metrics: EvidenceMetricLink[];
  /** What the person asking may do with it now. */
  can: { review: ReviewLevel | null; resubmit: boolean; linkMetrics: boolean };
}

export interface MyEvidence {
  counts: { uploaded: number; approved: number; inReview: number; needsFix: number };
  items: EvidenceSummary[];
}

export interface ReviewQueue {
  /** Oldest first, so nothing waits longest. At most 50; `total` says how many there are. */
  items: EvidenceSummary[];
  total: number;
}

/** A library card: the summary plus where it counts (e.g. "NAAC 2.4.1"). */
export interface EvidenceCard extends EvidenceSummary {
  tags: string[];
}

export interface EvidenceLibraryPage {
  items: EvidenceCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EvidenceVersionView {
  version: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  current: boolean;
}

export interface BulkLinkResult {
  linked: number;
  /** Items the person may not change, already linked, or rejected. */
  skipped: number;
}

/** Short-lived links to download several files (for a ZIP built in the browser). */
export interface DownloadLink {
  id: string;
  fileName: string;
  url: string;
}
