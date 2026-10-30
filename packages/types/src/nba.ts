// NBA outcomes (decided 2026-10-17, docs/PRODUCT.md "NBA outcomes").

/** How attainment is worked out for a program. Every program starts with DEFAULT_ATTAINMENT_RULES. */
export interface AttainmentRules {
  /** A student "reaches" a CO in an assessment at this share of the maximum marks. */
  targetMarkPercent: number;
  /** Share of students reaching the target mark needed for level 3, 2 and 1. */
  levels: { level3: number; level2: number; level1: number };
  /** Direct attainment = internal × internalWeight + end exam × endExamWeight (percentages adding up to 100). */
  internalWeight: number;
  endExamWeight: number;
  /** Final attainment = direct × directWeight + indirect × indirectWeight (percentages adding up to 100). */
  directWeight: number;
  indirectWeight: number;
  /** A CO meets its target at this final attainment (on the 0–3 scale). */
  coTarget: number;
}

export const DEFAULT_ATTAINMENT_RULES: AttainmentRules = {
  targetMarkPercent: 60,
  levels: { level3: 70, level2: 60, level1: 50 },
  internalWeight: 40,
  endExamWeight: 60,
  directWeight: 80,
  indirectWeight: 20,
  coTarget: 2,
};

export type CourseStatus = 'draft' | 'locked';
export type AssessmentKind = 'internal' | 'end_exam';
export type OutcomeKind = 'PO' | 'PSO';

export interface ProgramOutcomeView {
  id: string;
  kind: OutcomeKind;
  code: string;
  statement: string;
  /** POs come from NBA and cannot be changed; PSOs belong to the program. */
  editable: boolean;
}

export interface CourseSummary {
  id: string;
  code: string;
  name: string;
  semester: number | null;
  teacher: { id: string; name: string } | null;
  status: CourseStatus;
  outcomes: number;
  /** Average final attainment of its COs, when every CO has one. */
  attainment: number | null;
  can: { edit: boolean; lock: boolean };
}

export interface ProgramNbaView {
  program: { id: string; name: string; departmentCode: string; nbaFormat: string | null };
  academicYear: { id: string; label: string; locked: boolean };
  rules: AttainmentRules;
  /** Vision, mission and PEOs (SAR criterion 1). */
  profile: { vision: string; mission: string; peos: { code: string; statement: string }[] };
  outcomes: ProgramOutcomeView[];
  /** Note on where the POs come from (e.g. not yet checked against the current SAR). */
  outcomesSource: { title: string; verified: boolean } | null;
  courses: CourseSummary[];
  /** PO attainment over the locked courses of the year; null where no locked course maps to it. */
  poAttainment: { outcomeId: string; value: number | null; courses: number }[];
  can: { manage: boolean; addCourse: boolean };
}

export interface AssessmentResultView {
  id: string;
  kind: AssessmentKind;
  name: string;
  attempted: number;
  reached: number;
}

export interface CourseOutcomeView {
  id: string;
  code: string;
  statement: string;
  indirectLevel: number | null;
  /** program outcome id → strength 1–3. */
  mapping: Record<string, number>;
  results: AssessmentResultView[];
  attainment: CoAttainment;
}

/** One CO's attainment, step by step, so the page can show how it was reached. */
export interface CoAttainment {
  internalPercent: number | null;
  endExamPercent: number | null;
  internalLevel: number | null;
  endExamLevel: number | null;
  direct: number | null;
  indirect: number | null;
  final: number | null;
  meetsTarget: boolean | null;
  /** Why final is missing, in plain words. */
  waitingFor: string | null;
}

export interface CourseView {
  id: string;
  code: string;
  name: string;
  semester: number | null;
  status: CourseStatus;
  lockedBy: string | null;
  lockedAt: string | null;
  teacher: { id: string; name: string } | null;
  program: { id: string; name: string };
  academicYear: { id: string; label: string };
  rules: AttainmentRules;
  programOutcomes: ProgramOutcomeView[];
  outcomes: CourseOutcomeView[];
  /** Course average of final attainment, direct and indirect (over COs that have them). */
  summary: { direct: number | null; indirect: number | null; final: number | null };
  /** Mapping-strength-weighted PO attainment from this course. */
  poAttainment: { outcomeId: string; value: number | null }[];
  can: { edit: boolean; lock: boolean; unlock: boolean };
}
