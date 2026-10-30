// Surveys (decided 2026-10-17).

export type SurveyStatus = 'draft' | 'open' | 'closed';

export interface SurveyTemplateView {
  code: string;
  name: string;
  audience: string;
  description: string;
  feeds: string[];
  scale: 3 | 5;
  perCourse: boolean;
}

export interface SurveySummary {
  id: string;
  title: string;
  template: { code: string; name: string };
  audience: string;
  status: SurveyStatus;
  responses: number;
  expected: number | null;
  /** responses ÷ expected, as a percentage; null without an expected number. */
  rate: number | null;
  closesOn: string | null;
  academicYear: string;
  course: { id: string; code: string; name: string } | null;
  can: { manage: boolean };
}

export interface SurveyQuestionResult {
  id: string;
  kind: 'rating' | 'comment';
  text: string;
  scale: 3 | 5;
  /** The course outcome a course exit question asks about. */
  courseOutcome: { id: string; code: string } | null;
  answers: number;
  average: number | null;
  /** How many chose 1, 2, … up to the scale. */
  distribution: number[];
}

export interface SurveyView extends SurveySummary {
  /** Path of the open link, e.g. /s/abc123 (the web app adds the college's address). */
  link: string;
  feeds: string[];
  questions: SurveyQuestionResult[];
  comments: { question: string; text: string; at: string }[];
  /** For a closed course exit survey: what happened to the course's indirect attainment. */
  courseNote: string | null;
}

/** What the open link shows: no results, no other survey, only the questions. */
export interface PublicSurveyView {
  college: string;
  title: string;
  audience: string;
  status: SurveyStatus;
  questions: { id: string; kind: 'rating' | 'comment'; text: string; scale: 3 | 5 }[];
}
