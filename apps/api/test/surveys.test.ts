// Surveys: the open link (no sign-in, one answer per device), results and comments, course exit surveys setting NBA
// indirect attainment, who may run which survey, and tenancy.

import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { NbaService } from '../src/nba/nba.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { SurveysService } from '../src/surveys/surveys.service.js';

let database: Database;
let prisma: PrismaService;
let surveys: SurveysService;
let nba: NbaService;
let iqac: AuthUser;
let hod: AuthUser;
let faculty: AuthUser;
let office: AuthUser;
let coordinator: AuthUser;
let otherAdmin: AuthUser;
let year: string;
let cse: string;

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof HttpException) return (error.getResponse() as { code: string }).code;
    throw error;
  }
  return 'no_error';
}

async function actor(subdomain: string, email: string): Promise<AuthUser> {
  const collegeId = (await prisma.resolveCollegeId(subdomain))!;
  const user = await prisma.forTenant(collegeId, (db) => db.user.findFirstOrThrow({ where: { collegeId, email }, include: { roles: true } }));
  return { id: user.id, collegeId, roles: user.roles.map(({ role, departmentId }) => ({ role, departmentId })) };
}

const tokenOf = (view: { link: string }) => view.link.replace('/s/', '');
const device = (n: number) => `device-token-${String(n).padStart(4, '0')}-abcdef`;

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (owner) => {
      await seed(owner);
      const other = await owner.college.create({ data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' } });
      await owner.user.create({
        data: { collegeId: other.id, name: 'Other College Admin', email: 'admin@other-college.example', status: 'active', roles: { create: [{ collegeId: other.id, role: 'iqac' }] } },
      });
    },
  });
  prisma = new PrismaService(database);
  const permissions = new PermissionsService(prisma);
  surveys = new SurveysService(prisma, permissions);
  nba = new NbaService(prisma, permissions);
  iqac = await actor('sample', 'iqac@sample-college.example');
  hod = await actor('sample', 'hod.cse@sample-college.example');
  faculty = await actor('sample', 'faculty@sample-college.example');
  office = await actor('sample', 'office@sample-college.example');
  coordinator = await actor('sample', 'nba@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');
  await prisma.forTenant(iqac.collegeId, async (db) => {
    year = (await db.academicYear.findFirstOrThrow({ where: { collegeId: iqac.collegeId, status: 'current' } })).id;
    cse = (await db.program.findFirstOrThrow({ where: { collegeId: iqac.collegeId, department: { code: 'CSE' } } })).id;
  });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Templates', () => {
  it('offers the six kinds, course exit on a 1–3 scale', () => {
    const list = surveys.templates();
    expect(list.map((t) => t.code)).toEqual(['student_satisfaction', 'course_exit', 'alumni', 'employer', 'parent', 'teacher_curriculum']);
    expect(list.find((t) => t.code === 'course_exit')).toMatchObject({ scale: 3, perCourse: true, feeds: ['NBA indirect attainment'] });
  });
});

describe('The open link', () => {
  let token = '';
  let id = '';

  it('shows no questions until the survey is opened', async () => {
    const created = await surveys.create(iqac, { templateCode: 'student_satisfaction', title: 'Student satisfaction 2026–27', academicYearId: year, expectedResponses: 4 });
    expect(created.status).toBe('draft');
    id = created.id;
    token = tokenOf(created);
    expect(await surveys.publicView(token)).toMatchObject({ status: 'draft', questions: [], college: expect.any(String) });
    expect(await codeOf(surveys.answer(token, { deviceToken: device(1), answers: [{ questionId: created.questions[0]!.id, rating: 5 }] }))).toBe('survey_closed');
    await surveys.setStatus(iqac, id, 'open');
    const view = await surveys.publicView(token);
    expect(view.status).toBe('open');
    expect(view.questions).toHaveLength(8);
  });

  it('takes one answer per device, checks ratings, and keeps comments', async () => {
    const view = await surveys.publicView(token);
    const [q1, q2] = view.questions;
    const comment = view.questions.find((q) => q.kind === 'comment')!;
    await surveys.answer(token, { deviceToken: device(1), answers: [{ questionId: q1!.id, rating: 5 }, { questionId: q2!.id, rating: 4 }, { questionId: comment.id, comment: 'More lab hours, please.' }] });
    await surveys.answer(token, { deviceToken: device(2), answers: [{ questionId: q1!.id, rating: 3 }] });
    expect(await codeOf(surveys.answer(token, { deviceToken: device(1), answers: [{ questionId: q1!.id, rating: 1 }] }))).toBe('already_answered');
    expect(await codeOf(surveys.answer(token, { deviceToken: device(3), answers: [{ questionId: q1!.id, rating: 6 }] }))).toBe('invalid_input');
    expect(await codeOf(surveys.answer(token, { deviceToken: device(3), answers: [{ questionId: comment.id, rating: 4 }] }))).toBe('invalid_input');
    expect(await codeOf(surveys.answer('no-such-token-here', { deviceToken: device(3), answers: [{ questionId: q1!.id, rating: 4 }] }))).toBe('not_found');

    const results = await surveys.get(iqac, id);
    expect(results).toMatchObject({ responses: 2, expected: 4, rate: 50 });
    expect(results.questions[0]).toMatchObject({ answers: 2, average: 4, distribution: [0, 0, 1, 0, 1] });
    expect(results.comments.map((c) => c.text)).toEqual(['More lab hours, please.']);
  });

  it('stops taking answers after the closing date, and keeps answered surveys', async () => {
    await prisma.forTenant(iqac.collegeId, (db) => db.survey.update({ where: { id }, data: { closesOn: new Date('2020-01-01') } }));
    expect((await surveys.publicView(token)).status).toBe('closed');
    expect(await codeOf(surveys.remove(iqac, id))).toBe('has_answers');
  });
});

describe('Course exit survey → NBA indirect attainment', () => {
  let courseId = '';
  let surveyId = '';

  it('is started by the course teacher, with one 1–3 question per CO', async () => {
    const course = await nba.createCourse(hod, cse, { academicYearId: year, code: 'CS501', name: 'Machine Learning', teacherId: faculty.id });
    courseId = course.id;
    expect(await codeOf(surveys.create(faculty, { templateCode: 'course_exit', title: 'CS501 exit', academicYearId: year, courseId }))).toBe('no_outcomes');
    await nba.setOutcomes(faculty, courseId, {
      outcomes: [
        { code: 'CO1', statement: 'Explain supervised learning.' },
        { code: 'CO2', statement: 'Apply regression to real data' },
      ],
    });
    const survey = await surveys.create(faculty, { templateCode: 'course_exit', title: 'CS501 exit survey', academicYearId: year, courseId });
    surveyId = survey.id;
    expect(survey.questions.map((q) => [q.text, q.scale, q.courseOutcome?.code ?? null])).toEqual([
      ['I can explain supervised learning.', 3, 'CO1'],
      ['I can apply regression to real data.', 3, 'CO2'],
      ['What would have helped you learn this course better?', 3, null],
    ]);
    expect(await codeOf(surveys.create(faculty, { templateCode: 'student_satisfaction', title: 'Mine', academicYearId: year }))).toBe('forbidden');
    expect(await codeOf(surveys.create(office, { templateCode: 'course_exit', title: 'Office', academicYearId: year, courseId }))).toBe('forbidden');
    expect((await surveys.list(faculty)).map((s) => s.id)).toEqual([surveyId]);
    expect((await surveys.list(coordinator)).map((s) => s.id)).toEqual([surveyId]);
  });

  it('sets each CO’s indirect level from the average when closed, unless the course is locked', async () => {
    await surveys.setStatus(faculty, surveyId, 'open');
    const view = await surveys.publicView(tokenOf(await surveys.get(faculty, surveyId)));
    const [co1, co2] = view.questions;
    const token = tokenOf(await surveys.get(faculty, surveyId));
    await surveys.answer(token, { deviceToken: device(11), answers: [{ questionId: co1!.id, rating: 3 }, { questionId: co2!.id, rating: 2 }] });
    await surveys.answer(token, { deviceToken: device(12), answers: [{ questionId: co1!.id, rating: 2 }, { questionId: co2!.id, rating: 1 }] });
    expect(await codeOf(surveys.answer(token, { deviceToken: device(13), answers: [{ questionId: co1!.id, rating: 4 }] }))).toBe('invalid_input');

    await nba.setLocked(hod, courseId, true);
    const refused = await surveys.setStatus(faculty, surveyId, 'closed');
    expect(refused.courseNote).toMatch(/CS501 is locked/);
    await nba.setLocked(hod, courseId, false);
    await surveys.setStatus(faculty, surveyId, 'open');
    const closed = await surveys.setStatus(faculty, surveyId, 'closed');
    expect(closed.courseNote).toBe('Indirect attainment set from the survey: CO1 2.50, CO2 1.50 (2 answers).');
    const course = await nba.course(faculty, courseId);
    expect(course.outcomes.map((o) => o.indirectLevel)).toEqual([2.5, 1.5]);
  });
});

describe('Tenancy', () => {
  it('shows another college nothing', async () => {
    const mine = (await surveys.list(iqac))[0]!;
    expect(await codeOf(surveys.get(otherAdmin, mine.id))).toBe('not_found');
    expect(await surveys.list(otherAdmin)).toEqual([]);
  });

  it('deletes a survey nobody has answered', async () => {
    const draft = await surveys.create(iqac, { templateCode: 'parent', title: 'Parents 2026', academicYearId: year });
    await surveys.remove(iqac, draft.id);
    expect(await codeOf(surveys.get(iqac, draft.id))).toBe('not_found');
  });
});
