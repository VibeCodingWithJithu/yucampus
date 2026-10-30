import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  type Grant,
  type PublicSurveyView,
  type SurveyQuestionResult,
  type SurveySummary,
  type SurveyTemplateView,
  type SurveyView,
  can,
  departmentsFor,
} from '@yucampus/types';
import {
  type CreateSurveyInput,
  type SurveyAnswersInput,
  type SurveyTemplates,
  createSurveySchema,
  surveyAnswersSchema,
  surveyTemplatesSchema,
} from '@yucampus/validation';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { fromIsoDate, isUniqueViolation, notFound, toIsoDate } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { indiaNow } from '../notifications/notifications.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';

const TEMPLATES: SurveyTemplates = surveyTemplatesSchema.parse(
  JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../rules/surveys/templates.json'), 'utf8')),
);
const COURSE_EXIT = 'course_exit';

/**
 * Who may run which surveys (docs/PRODUCT.md "Surveys", decided 2026-10-17): surveys.manage at college runs every
 * kind; at NBA scope, course exit surveys; and whoever may change a course (its teacher, HOD, NBA coordinator) may run
 * that course's exit survey.
 */
interface Access {
  all: boolean;
  courseExits: boolean;
  courses: { college: boolean; departments: string[]; teacher: string };
}

function accessFrom(grants: readonly Grant[], actorId: string): Access {
  return {
    all: can(grants, 'surveys.manage', ['college']),
    courseExits: can(grants, 'surveys.manage', ['college', 'nba']),
    courses: {
      college: can(grants, 'nba.manage', ['college']),
      departments: departmentsFor(grants, 'nba.manage'),
      teacher: can(grants, 'nba.manage', ['own']) ? actorId : '',
    },
  };
}

type SurveyRow = Prisma.SurveyGetPayload<{
  include: { course: { include: { program: { select: { departmentId: true } } } }; academicYear: true; _count: { select: { responses: true } } };
}>;

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const hashOf = (surveyId: string, deviceToken: string) => createHash('sha256').update(`${surveyId}:${deviceToken}`).digest('hex');
/** "Apply regression to real data" → "I can apply regression to real data." */
const coQuestion = (statement: string) => `I can ${statement.charAt(0).toLowerCase()}${statement.slice(1).replace(/\.$/, '')}.`;

@Injectable()
export class SurveysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private async access(actor: AuthUser) {
    return accessFrom(await this.permissions.grantsFor(actor.collegeId, actor.roles), actor.id);
  }

  templates(): SurveyTemplateView[] {
    return TEMPLATES.templates.map(({ code, name, audience, description, feeds, scale, perCourse }) => ({ code, name, audience, description, feeds, scale, perCourse }));
  }

  private template(code: string) {
    const template = TEMPLATES.templates.find((t) => t.code === code);
    if (!template) throw notFound('survey template');
    return template;
  }

  private managesCourse(access: Access, course: { teacherId: string | null; program: { departmentId: string } }) {
    return access.courseExits || access.courses.college || access.courses.departments.includes(course.program.departmentId) || (access.courses.teacher !== '' && course.teacherId === access.courses.teacher);
  }

  private canManage(access: Access, survey: Pick<SurveyRow, 'templateCode' | 'course'>) {
    if (access.all) return true;
    return survey.templateCode === COURSE_EXIT && survey.course !== null && this.managesCourse(access, survey.course);
  }

  private include = {
    course: { include: { program: { select: { departmentId: true } } } },
    academicYear: true,
    _count: { select: { responses: true } },
  } as const;

  private summary(row: SurveyRow, access: Access): SurveySummary {
    const template = TEMPLATES.templates.find((t) => t.code === row.templateCode);
    const responses = row._count.responses;
    return {
      id: row.id,
      title: row.title,
      template: { code: row.templateCode, name: template?.name ?? row.templateCode },
      audience: row.audience,
      status: row.status,
      responses,
      expected: row.expectedResponses,
      rate: row.expectedResponses ? Math.min(100, Math.round((responses / row.expectedResponses) * 100)) : null,
      closesOn: row.closesOn ? toIsoDate(row.closesOn) : null,
      academicYear: row.academicYear.label.replace('-', '–'),
      course: row.course ? { id: row.course.id, code: row.course.code, name: row.course.name } : null,
      can: { manage: this.canManage(access, row) },
    };
  }

  // ---------------------------------------------------------------- Running surveys

  async list(actor: AuthUser, courseId?: string): Promise<SurveySummary[]> {
    const access = await this.access(actor);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const rows = await db.survey.findMany({
        where: { collegeId: actor.collegeId, ...(courseId ? { courseId } : {}), ...(access.all ? {} : { templateCode: COURSE_EXIT }) },
        include: this.include,
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.filter((r) => this.canManage(access, r)).map((r) => this.summary(r, access));
    });
  }

  async create(actor: AuthUser, raw: CreateSurveyInput): Promise<SurveyView> {
    const access = await this.access(actor);
    const parsed = createSurveySchema.safeParse(raw);
    if (!parsed.success) throw apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Check the values.');
    const input = parsed.data;
    const template = this.template(input.templateCode);
    const id = await this.prisma.forTenant(actor.collegeId, async (db) => {
      const year = await db.academicYear.findFirst({ where: { id: input.academicYearId, collegeId: actor.collegeId } });
      if (!year) throw notFound('academic year');
      let course: Prisma.CourseGetPayload<{ include: { program: { select: { departmentId: true } }; outcomes: true } }> | null = null;
      if (template.perCourse) {
        if (!input.courseId) throw apiError(400, 'invalid_input', 'Choose the course this survey is for.');
        course = await db.course.findFirst({
          where: { id: input.courseId, collegeId: actor.collegeId },
          include: { program: { select: { departmentId: true } }, outcomes: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!course) throw notFound('course');
        if (!this.managesCourse(access, course)) throw apiError(403, 'forbidden', 'Only the course teacher, HOD or NBA coordinator can survey this course.');
        if (course.outcomes.length === 0) throw apiError(409, 'no_outcomes', 'Add the course outcomes first: the survey asks about each one.');
      } else if (!access.all) {
        throw apiError(403, 'forbidden', 'Only IQAC can run this kind of survey.');
      }
      const questions = [
        ...(course?.outcomes ?? []).map((o) => ({ kind: 'rating', text: coQuestion(o.statement), scale: template.scale, courseOutcomeId: o.id })),
        ...template.questions.map((q) => ({ kind: q.kind, text: q.text, scale: template.scale, courseOutcomeId: null })),
      ];
      const survey = await db.survey.create({
        data: {
          collegeId: actor.collegeId,
          templateCode: template.code,
          title: input.title,
          audience: template.audience,
          academicYearId: year.id,
          courseId: course?.id ?? null,
          publicToken: randomBytes(12).toString('base64url'),
          expectedResponses: input.expectedResponses ?? null,
          closesOn: input.closesOn ? fromIsoDate(input.closesOn) : null,
          createdById: actor.id,
          questions: { create: questions.map((q, index) => ({ ...q, collegeId: actor.collegeId, sortOrder: index })) },
        },
      });
      await audit(db, actor, 'survey', survey.id, 'create', { after: { template: template.code, title: input.title, course: course?.code ?? null } });
      return survey.id;
    });
    return this.get(actor, id);
  }

  private async row(db: TenantClient, actor: AuthUser, access: Access, id: string) {
    const row = await db.survey.findFirst({ where: { id, collegeId: actor.collegeId }, include: this.include });
    if (!row || !this.canManage(access, row)) throw notFound('survey');
    return row;
  }

  async get(actor: AuthUser, id: string): Promise<SurveyView> {
    const access = await this.access(actor);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const row = await this.row(db, actor, access, id);
      const questions = await db.surveyQuestion.findMany({
        where: { surveyId: id },
        include: { courseOutcome: { select: { id: true, code: true } }, answers: { include: { response: { select: { submittedAt: true } } } } },
        orderBy: { sortOrder: 'asc' },
      });
      const results: SurveyQuestionResult[] = questions.map((q) => {
        const ratings = q.answers.map((a) => a.rating).filter((r): r is number => r !== null);
        const scale = (q.scale === 3 ? 3 : 5) as 3 | 5;
        return {
          id: q.id,
          kind: q.kind as 'rating' | 'comment',
          text: q.text,
          scale,
          courseOutcome: q.courseOutcome,
          answers: q.kind === 'rating' ? ratings.length : q.answers.filter((a) => a.comment).length,
          average: ratings.length ? round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null,
          distribution: Array.from({ length: scale }, (_, i) => ratings.filter((r) => r === i + 1).length),
        };
      });
      const comments = questions
        .flatMap((q) => q.answers.filter((a) => a.comment).map((a) => ({ question: q.text, text: a.comment!, at: a.response.submittedAt.toISOString() })))
        .sort((a, b) => b.at.localeCompare(a.at));
      return {
        ...this.summary(row, access),
        link: `/s/${row.publicToken}`,
        feeds: TEMPLATES.templates.find((t) => t.code === row.templateCode)?.feeds ?? [],
        questions: results,
        comments,
        courseNote: row.courseNote,
      };
    });
  }

  /**
   * Opens or closes a survey. Closing a course exit survey turns each CO's average (1–3) into its indirect
   * attainment, as long as the course is not locked; the note says what happened.
   */
  async setStatus(actor: AuthUser, id: string, status: 'open' | 'closed'): Promise<SurveyView> {
    const access = await this.access(actor);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const row = await this.row(db, actor, access, id);
      let courseNote: string | null = row.courseNote;
      if (status === 'closed' && row.templateCode === COURSE_EXIT && row.courseId) {
        const course = await db.course.findFirstOrThrow({ where: { id: row.courseId } });
        const questions = await db.surveyQuestion.findMany({ where: { surveyId: id, courseOutcomeId: { not: null } }, include: { answers: true, courseOutcome: true } });
        const averages = questions
          .map((q) => {
            const ratings = q.answers.map((a) => a.rating).filter((r): r is number => r !== null);
            return { outcome: q.courseOutcome!, average: ratings.length ? round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null, count: ratings.length };
          })
          .filter((a) => a.average !== null);
        if (averages.length === 0) courseNote = 'No answers yet, so the indirect attainment was not changed.';
        else if (course.status === 'locked') courseNote = `${course.code} is locked, so its indirect attainment was not changed. Unlock it, then close the survey again to apply.`;
        else {
          for (const a of averages) await db.courseOutcome.update({ where: { id: a.outcome.id }, data: { indirectLevel: a.average } });
          courseNote = `Indirect attainment set from the survey: ${averages.map((a) => `${a.outcome.code} ${a.average!.toFixed(2)}`).join(', ')} (${row._count.responses} answers).`;
          await audit(db, actor, 'course', course.id, 'indirect_from_survey', { after: Object.fromEntries(averages.map((a) => [a.outcome.code, a.average])) });
        }
      }
      await db.survey.update({ where: { id }, data: { status, courseNote } });
      await audit(db, actor, 'survey', id, status === 'open' ? 'open' : 'close');
    });
    return this.get(actor, id);
  }

  /** Only a survey nobody has answered can be deleted; answered ones are kept for the record. */
  async remove(actor: AuthUser, id: string): Promise<void> {
    const access = await this.access(actor);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const row = await this.row(db, actor, access, id);
      if (row._count.responses > 0) throw apiError(409, 'has_answers', 'People have answered this survey. Close it instead; answers are kept.');
      await db.survey.delete({ where: { id } });
      await audit(db, actor, 'survey', id, 'delete', { before: { title: row.title } });
    });
  }

  // ---------------------------------------------------------------- The open link (no sign-in)

  private async publicRow(token: string) {
    const collegeId = /^[A-Za-z0-9_-]{8,40}$/.test(token) ? await this.prisma.surveyCollegeId(token) : null;
    if (!collegeId) throw notFound('survey');
    return collegeId;
  }

  /** A survey is open until it is closed by hand or its closing date has passed (India time). */
  private isOpen(survey: { status: string; closesOn: Date | null }) {
    return survey.status === 'open' && (!survey.closesOn || toIsoDate(survey.closesOn) >= indiaNow().date);
  }

  async publicView(token: string): Promise<PublicSurveyView> {
    const collegeId = await this.publicRow(token);
    return this.prisma.forTenant(collegeId, async (db) => {
      const survey = await db.survey.findFirstOrThrow({
        where: { publicToken: token, collegeId },
        include: { questions: { orderBy: { sortOrder: 'asc' } } },
      });
      const college = await db.college.findUniqueOrThrow({ where: { id: collegeId }, select: { name: true } });
      const open = this.isOpen(survey);
      return {
        college: college.name,
        title: survey.title,
        audience: survey.audience,
        status: open ? 'open' : survey.status === 'draft' ? 'draft' : 'closed',
        // Questions are shown only while the survey is open.
        questions: open ? survey.questions.map((q) => ({ id: q.id, kind: q.kind as 'rating' | 'comment', text: q.text, scale: (q.scale === 3 ? 3 : 5) as 3 | 5 })) : [],
      };
    });
  }

  async answer(token: string, raw: SurveyAnswersInput): Promise<{ thanks: true }> {
    const parsed = surveyAnswersSchema.safeParse(raw);
    if (!parsed.success) throw apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Check your answers.');
    const input = parsed.data;
    const collegeId = await this.publicRow(token);
    await this.prisma.forTenant(collegeId, async (db) => {
      const survey = await db.survey.findFirstOrThrow({ where: { publicToken: token, collegeId }, include: { questions: true } });
      if (!this.isOpen(survey)) throw apiError(409, 'survey_closed', 'This survey is not open for answers.');
      const byId = new Map(survey.questions.map((q) => [q.id, q]));
      const answers = input.answers.filter((a) => (a.rating ?? null) !== null || (a.comment ?? '').trim() !== '');
      if (answers.length === 0) throw apiError(400, 'invalid_input', 'Answer at least one question.');
      for (const a of answers) {
        const q = byId.get(a.questionId);
        if (!q) throw apiError(400, 'invalid_input', 'An answer is for a question that is not in this survey.');
        if (q.kind === 'rating' && (a.rating === null || a.rating === undefined || a.rating > q.scale)) throw apiError(400, 'invalid_input', `Choose 1 to ${q.scale} for “${q.text}”.`);
        if (q.kind === 'comment' && a.rating) throw apiError(400, 'invalid_input', 'A comment question takes words, not a rating.');
      }
      try {
        await db.surveyResponse.create({
          data: {
            collegeId,
            surveyId: survey.id,
            deviceHash: hashOf(survey.id, input.deviceToken),
            answers: {
              create: answers.map((a) => ({
                collegeId,
                questionId: a.questionId,
                rating: byId.get(a.questionId)!.kind === 'rating' ? (a.rating ?? null) : null,
                comment: byId.get(a.questionId)!.kind === 'comment' ? (a.comment?.trim() ?? null) : null,
              })),
            },
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw apiError(409, 'already_answered', 'This device has already answered this survey. Thank you!');
        throw error;
      }
    });
    return { thanks: true };
  }
}
