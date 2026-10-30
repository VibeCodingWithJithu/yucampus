// CO and PO attainment (docs/PRODUCT.md "NBA outcomes"). Plain functions so the rules can be tested on their own.
// Nothing is guessed: a missing input gives null and says what it is waiting for.

import { type AttainmentRules, type CoAttainment, DEFAULT_ATTAINMENT_RULES } from '@yucampus/types';
import { attainmentRulesSchema } from '@yucampus/validation';

// Half-up on the decimal value people see: 2.115 is stored as 2.11499…, so nudge by a tiny amount before rounding.
const round = (value: number, places = 2) => Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * 10 ** places) / 10 ** places;

/** A program's stored rules over the defaults; anything invalid falls back to the defaults. */
export function rulesOf(raw: unknown): AttainmentRules {
  const merged = { ...DEFAULT_ATTAINMENT_RULES, ...((raw ?? {}) as object) };
  const parsed = attainmentRulesSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_ATTAINMENT_RULES;
}

/** 3, 2, 1 or 0 from the share of students who reached the target mark. */
export function levelFor(percent: number, rules: AttainmentRules): number {
  if (percent >= rules.levels.level3) return 3;
  if (percent >= rules.levels.level2) return 2;
  if (percent >= rules.levels.level1) return 1;
  return 0;
}

interface Result {
  kind: string;
  attempted: number;
  reached: number;
}

function share(results: readonly Result[], kind: string): number | null {
  const of = results.filter((r) => r.kind === kind);
  const attempted = of.reduce((sum, r) => sum + r.attempted, 0);
  return attempted ? round((of.reduce((sum, r) => sum + r.reached, 0) / attempted) * 100, 1) : null;
}

export function coAttainment(results: readonly Result[], indirectLevel: number | null, rules: AttainmentRules): CoAttainment {
  const internalPercent = share(results, 'internal');
  const endExamPercent = share(results, 'end_exam');
  const internalLevel = internalPercent === null ? null : levelFor(internalPercent, rules);
  const endExamLevel = endExamPercent === null ? null : levelFor(endExamPercent, rules);
  const direct =
    internalLevel === null || endExamLevel === null ? null : round((internalLevel * rules.internalWeight + endExamLevel * rules.endExamWeight) / 100);
  const indirect = indirectLevel ?? null;
  const final = direct === null || indirect === null ? null : round((direct * rules.directWeight + indirect * rules.indirectWeight) / 100);
  const waitingFor =
    internalLevel === null && endExamLevel === null
      ? 'assessment results'
      : internalLevel === null
        ? 'internal assessment results'
        : endExamLevel === null
          ? 'end exam results'
          : indirect === null
            ? 'the course exit survey (indirect attainment)'
            : null;
  return { internalPercent, endExamPercent, internalLevel, endExamLevel, direct, indirect, final, meetsTarget: final === null ? null : final >= rules.coTarget, waitingFor };
}

/**
 * PO attainment from one course: the mapping-strength-weighted average of the final attainment of the COs mapped to
 * it. Null when no CO maps to the PO, or when a mapped CO has no final attainment yet.
 */
export function poAttainment(outcomes: readonly { final: number | null; mapping: Record<string, number> }[], programOutcomeId: string): number | null {
  const mapped = outcomes.filter((o) => (o.mapping[programOutcomeId] ?? 0) > 0);
  if (mapped.length === 0 || mapped.some((o) => o.final === null)) return null;
  const weight = mapped.reduce((sum, o) => sum + o.mapping[programOutcomeId]!, 0);
  return round(mapped.reduce((sum, o) => sum + o.mapping[programOutcomeId]! * o.final!, 0) / weight);
}

/** Average of the values that exist, or null. */
export function averageOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? round(present.reduce((a, b) => a + b, 0) / present.length) : null;
}
