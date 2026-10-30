import type { EvidenceStage } from '@yucampus/types';
import { StatusPill, type StatusTone } from '@yucampus/ui';

const TONE: Record<EvidenceStage['status'], StatusTone> = {
  in_review: 'attention',
  department_approved: 'attention',
  approved: 'good',
  needs_fix: 'problem',
  rejected: 'problem',
};

const SHORT: Record<EvidenceStage['status'], string> = {
  in_review: 'In review',
  department_approved: 'HOD approved',
  approved: 'Approved',
  needs_fix: 'Needs fix',
  rejected: 'Rejected',
};

/** Colour plus words, always (accessibility rule). The full stage is in the title for hover. */
export function EvidenceStatus({ stage }: { stage: EvidenceStage }) {
  return (
    <span title={stage.label}>
      <StatusPill tone={TONE[stage.status]}>{SHORT[stage.status]}</StatusPill>
    </span>
  );
}
