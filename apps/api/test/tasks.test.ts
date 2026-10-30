// Tasks and notifications: giving tasks, who sees them, uploads for a task, reminders and the emails behind them.

import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { createEvidenceSchema, notificationsQuerySchema, reviewSchema, taskInputSchema } from '@yucampus/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccreditationService } from '../src/accreditation/accreditation.service.js';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { AppConfig } from '../src/config.js';
import { EvidenceService } from '../src/evidence/evidence.service.js';
import { InProcessJobs } from '../src/jobs/jobs.js';
import { ConsoleEmailSender } from '../src/mail/email-sender.js';
import { NotificationsService, indiaNow } from '../src/notifications/notifications.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { TasksService, nextDue } from '../src/tasks/tasks.service.js';
import { MemoryStorage } from './memory-storage.js';

const PDF = new TextEncoder().encode('%PDF-1.4\n% task evidence\n');
const DAY = 24 * 60 * 60 * 1000;

let database: Database;
let prisma: PrismaService;
let storage: MemoryStorage;
let mail: ConsoleEmailSender;
let notifications: NotificationsService;
let tasks: TasksService;
let evidence: EvidenceService;
let faculty: AuthUser;
let hod: AuthUser;
let iqac: AuthUser;
let office: AuthUser;
let otherAdmin: AuthUser;
let cseId: string;
let eceId: string;
let metric: { id: string; documentKey: string };

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
  const user = await prisma.forTenant(collegeId, (db) =>
    db.user.findFirstOrThrow({ where: { collegeId, email }, include: { roles: true } }),
  );
  return { id: user.id, collegeId, roles: user.roles.map(({ role, departmentId }) => ({ role, departmentId })) };
}

// Days are counted in India time, like the reminders themselves.
const dateIn = (days: number) => indiaNow(new Date(Date.now() + days * DAY)).date;

const newTask = (who: AuthUser, input: Partial<Parameters<typeof taskInputSchema.parse>[0]> = {}) =>
  tasks.create(
    who,
    taskInputSchema.parse({
      title: 'Upload FDP certificates',
      assignee: { kind: 'user', id: faculty.id },
      dueDate: dateIn(10),
      ...input,
    }),
  );

async function uploadFor(who: AuthUser, taskId: string, title = 'FDP certificate') {
  const ticket = await evidence.requestUpload(who, {
    fileName: 'Certificate.pdf',
    contentType: 'application/pdf',
    size: PDF.length,
    sha256: createHash('sha256').update(PDF).digest('hex'),
  });
  storage.put(ticket.url.replace('memory://', ''), PDF, 'application/pdf');
  return evidence.create(who, createEvidenceSchema.parse({ uploadToken: ticket.uploadToken, title, documentDate: '2026-08-20', taskId }));
}

const decide = (who: AuthUser, id: string, input: Parameters<typeof reviewSchema.parse>[0]) =>
  evidence.review(who, id, reviewSchema.parse(input) as never);

const inbox = (who: AuthUser, filter: 'all' | 'unread' | 'deadlines' | 'tasks' = 'all') =>
  notifications.list(who, notificationsQuerySchema.parse({ filter }));

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (owner) => {
      await seed(owner);
      const other = await owner.college.create({
        data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' },
      });
      await owner.academicYear.create({
        data: { collegeId: other.id, label: '2026-27', startDate: new Date('2026-07-01'), endDate: new Date('2027-06-30'), status: 'current' },
      });
      await owner.user.create({
        data: {
          collegeId: other.id,
          name: 'Other College Admin',
          email: 'admin@other-college.example',
          status: 'active',
          roles: { create: [{ collegeId: other.id, role: 'college_admin' }, { collegeId: other.id, role: 'iqac' }] },
        },
      });
    },
  });
  prisma = new PrismaService(database);
  storage = new MemoryStorage();
  mail = new ConsoleEmailSender();
  const jobs = new InProcessJobs();
  // Emails are sent by calling flushEmails() in the tests, not in the background.
  jobs.register('email.flush', async () => {});
  const permissions = new PermissionsService(prisma);
  const accreditation = new AccreditationService(prisma);
  notifications = new NotificationsService(prisma, jobs, mail, new AppConfig());
  tasks = new TasksService(prisma, permissions, notifications, accreditation, jobs);
  evidence = new EvidenceService(prisma, storage, permissions, new AppConfig(), accreditation, notifications);
  faculty = await actor('sample', 'faculty@sample-college.example');
  hod = await actor('sample', 'hod.cse@sample-college.example');
  iqac = await actor('sample', 'iqac@sample-college.example');
  office = await actor('sample', 'office@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');

  await prisma.forTenant(iqac.collegeId, async (db) => {
    const departments = await db.department.findMany({ where: { collegeId: iqac.collegeId } });
    cseId = departments.find((d) => d.code === 'CSE')!.id;
    eceId = departments.find((d) => d.code === 'ECE')!.id;
    const active = await accreditation.activeFrameworkIds(db, iqac.collegeId);
    const metrics = await db.metric.findMany({ where: { criterion: { frameworkId: { in: active } } } });
    const withDocs = metrics.find((m) => Array.isArray(m.requiredDocuments) && m.requiredDocuments.length > 0)!;
    metric = { id: withDocs.id, documentKey: (withDocs.requiredDocuments as { key: string }[])[0]!.key };
  });
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Giving tasks', () => {
  it('IQAC gives a task to a person, who is told about it', async () => {
    const task = await newTask(iqac, { metricId: metric.id, documentKey: metric.documentKey });
    expect(task.stage).toBe('to_do');
    expect(task.assignee).toMatchObject({ kind: 'user', id: faculty.id });
    expect(task.metric?.id).toBe(metric.id);
    expect(task.documentName).toBeTruthy();

    const page = await inbox(faculty, 'tasks');
    expect(page.items.some((n) => n.kind === 'task_assigned' && n.link === `/tasks?task=${task.id}`)).toBe(true);
    expect(page.unread).toBeGreaterThan(0);
  });

  it('a department task reaches every faculty member and the head of that department', async () => {
    const task = await newTask(iqac, { title: 'Department newsletter', assignee: { kind: 'department', id: cseId } });
    expect(task.assignee.name).toBe('All CSE faculty');
    for (const who of [faculty, hod]) {
      const page = await inbox(who);
      expect(page.items.some((n) => n.link === `/tasks?task=${task.id}`)).toBe(true);
    }
  });

  it('a HOD gives tasks to their own department only', async () => {
    expect((await newTask(hod, { title: 'CSE lab records' })).createdBy).toBeTruthy();
    expect(await codeOf(newTask(hod, { title: 'ECE work', assignee: { kind: 'department', id: eceId } }))).toBe('department_only');
    expect(await codeOf(newTask(hod, { title: 'Office work', assignee: { kind: 'user', id: office.id } }))).toBe('department_only');
  });

  it('offers a HOD only their own department and its people', async () => {
    const mine = await tasks.assignees(hod);
    expect(mine.departments.map((d) => d.code)).toEqual(['CSE']);
    expect(mine.people.some((p) => p.id === faculty.id)).toBe(true);
    expect(mine.people.some((p) => p.id === office.id)).toBe(false);
    expect((await tasks.assignees(iqac)).departments.length).toBeGreaterThan(1);
    expect(await tasks.assignees(faculty)).toEqual({ departments: [], people: [] });
  });

  it('faculty and office staff cannot give tasks', async () => {
    expect(await codeOf(newTask(faculty, { assignee: { kind: 'user', id: hod.id } }))).toBe('forbidden');
    expect(await codeOf(newTask(office))).toBe('forbidden');
  });

  it('rejects a metric document the metric does not need', async () => {
    expect(await codeOf(newTask(iqac, { metricId: metric.id, documentKey: 'not_a_document' }))).toBe('invalid_input');
  });

  it('only the person who gave a task (or IQAC) changes it', async () => {
    const task = await newTask(hod, { title: 'HOD task' });
    expect(await codeOf(tasks.setDone(faculty, task.id, true))).toBe('forbidden');
    const done = await tasks.setDone(iqac, task.id, true);
    expect(done.stage).toBe('approved');
    expect((await tasks.setDone(hod, task.id, false)).stage).toBe('to_do');
    await tasks.remove(hod, task.id);
    expect(await codeOf(tasks.get(hod, task.id))).toBe('not_found');
  });

  it('another college sees none of these tasks', async () => {
    const board = await tasks.board(otherAdmin);
    expect(board.tasks).toEqual([]);
    const task = await newTask(iqac, { title: 'Private to the sample college' });
    expect(await codeOf(tasks.get(otherAdmin, task.id))).toBe('not_found');
    expect(await codeOf(newTask(otherAdmin, { title: 'Cross-college' }))).toBe('not_found');
  });

  it('office staff do not see tasks given to others', async () => {
    const board = await tasks.board(office);
    expect(board.tasks.every((t) => t.assignee.id === office.id)).toBe(true);
  });
});

describe('Uploading for a task', () => {
  it('moves the task through submitted, approved, and completes it on final approval', async () => {
    const task = await newTask(iqac, { title: 'Workshop report', metricId: metric.id, documentKey: metric.documentKey });
    expect(task.can.upload).toBe(false); // IQAC gave it; the faculty member uploads.
    expect((await tasks.get(faculty, task.id)).can.upload).toBe(true);
    const item = await uploadFor(faculty, task.id, 'Workshop report 2026');
    expect(item.metrics.map((m) => m.metricId)).toContain(metric.id);
    expect((await tasks.get(iqac, task.id)).stage).toBe('submitted');

    // The HOD is told there is something to review.
    expect((await inbox(hod)).items.some((n) => n.kind === 'review_waiting' && n.text.includes('Workshop report 2026'))).toBe(true);

    await decide(hod, item.id, { decision: 'approve' });
    // Then the final approvers (IQAC) are told.
    expect((await inbox(iqac)).items.some((n) => n.kind === 'review_waiting' && n.text.includes('final'))).toBe(true);
    expect((await tasks.get(iqac, task.id)).stage).toBe('submitted');

    await decide(iqac, item.id, { decision: 'approve' });
    const after = await tasks.get(iqac, task.id);
    expect(after.stage).toBe('approved');
    expect(after.can.edit).toBe(true);
    const row = await prisma.forTenant(iqac.collegeId, (db) => db.task.findUniqueOrThrow({ where: { id: task.id } }));
    expect(row.status).toBe('done');
    expect((await inbox(faculty)).items.some((n) => n.kind === 'evidence_approved')).toBe(true);
  });

  it('tells the uploader when an item is sent back, and the task shows it is in progress', async () => {
    const task = await newTask(iqac, { title: 'Seminar photos' });
    const item = await uploadFor(faculty, task.id, 'Seminar photos');
    await decide(hod, item.id, { decision: 'needs_fix', comment: 'Add the date on the photo' });
    expect((await tasks.get(iqac, task.id)).stage).toBe('in_progress');
    const sentBack = (await inbox(faculty)).items.find((n) => n.kind === 'evidence_needs_fix');
    expect(sentBack?.text).toContain('Add the date on the photo');
  });

  it('refuses an upload for somebody else’s task, or a task that is done', async () => {
    const forHod = await newTask(iqac, { title: 'Only for the HOD', assignee: { kind: 'user', id: hod.id } });
    expect(await codeOf(uploadFor(faculty, forHod.id))).toBe('forbidden');
    const closed = await newTask(iqac, { title: 'Already closed' });
    await tasks.setDone(iqac, closed.id, true);
    expect(await codeOf(uploadFor(faculty, closed.id))).toBe('task_done');
  });
});

describe('Reminders', () => {
  it('reminds before the due date and when overdue, once per reminder, however often the sweep runs', async () => {
    const soon = await newTask(iqac, { title: 'Due in three days', dueDate: dateIn(3) });
    await tasks.sweep();
    await tasks.sweep();
    const due = (await inbox(faculty, 'deadlines')).items.filter((n) => n.link === `/tasks?task=${soon.id}`);
    expect(due).toHaveLength(1);
    expect(due[0]!.text).toMatch(/Due in 3 days/);

    // Make a task overdue: the board says so, and one overdue reminder goes out.
    const late = await newTask(iqac, { title: 'Was due last week', dueDate: dateIn(10) });
    await prisma.forTenant(iqac.collegeId, (db) => db.task.update({ where: { id: late.id }, data: { dueDate: new Date(Date.now() - 7 * DAY) } }));
    expect((await tasks.get(iqac, late.id)).overdue).toBe(true);
    await tasks.sweep();
    await tasks.sweep();
    const overdue = (await inbox(faculty, 'deadlines')).items.filter((n) => n.kind === 'task_overdue' && n.link === `/tasks?task=${late.id}`);
    expect(overdue).toHaveLength(1);

    // "Remind everyone now" adds one reminder for today, not more.
    const first = await tasks.remindOverdue(iqac);
    expect(first.reminded).toBeGreaterThan(0);
    expect((await tasks.remindOverdue(iqac)).reminded).toBe(0);
  });

  it('creates the next occurrence of a repeating task once, after it is done', async () => {
    const monthly = await newTask(iqac, { title: 'Monthly attendance report', repeat: 'month', dueDate: dateIn(5) });
    await tasks.setDone(iqac, monthly.id, true);
    const before = (await tasks.board(iqac)).tasks.filter((t) => t.title === 'Monthly attendance report').length;
    await tasks.sweep();
    await tasks.sweep();
    const board = (await tasks.board(iqac)).tasks.filter((t) => t.title === 'Monthly attendance report');
    expect(board).toHaveLength(before + 1);
    expect(board.some((t) => t.dueDate === nextDue(dateIn(5), 'month') && t.stage === 'to_do')).toBe(true);
  });

  it('works out next due dates by calendar month', () => {
    expect(nextDue('2026-01-31', 'month')).toBe('2026-02-28');
    expect(nextDue('2026-08-15', 'semester')).toBe('2027-02-15');
    expect(nextDue('2028-02-29', 'year')).toBe('2029-02-28');
  });
});

describe('Notifications', () => {
  it('marks some or all as read, only for the person', async () => {
    const page = await inbox(faculty, 'unread');
    expect(page.unread).toBeGreaterThan(1);
    const one = page.items[0]!;
    const afterOne = await notifications.markRead(faculty, [one.id]);
    expect(afterOne.unread).toBe(page.unread - 1);

    // IQAC cannot mark the faculty member's notifications as read.
    const hodUnread = (await notifications.unreadCount(hod)).unread;
    await notifications.markRead(iqac, [(await inbox(hod, 'unread')).items[0]!.id]);
    expect((await notifications.unreadCount(hod)).unread).toBe(hodUnread);

    expect((await notifications.markRead(faculty)).unread).toBe(0);
  });

  it('keeps in-app on, ignores WhatsApp, and saves the email choice', async () => {
    const saved = await notifications.setPreferences(faculty, {
      events: [{ event: 'deadline', channels: ['whatsapp'] }],
      emailDigest: '17',
    });
    expect(saved.events.find((e) => e.event === 'deadline')!.channels).toEqual(['in_app']);
    expect(saved.emailDigest).toBe('17');
  });

  it('emails right away by default, once per notification, and sends daily summaries at 9 and 17 India time', async () => {
    mail.sent.length = 0;
    await newTask(iqac, { title: 'Email me this task', assignee: { kind: 'user', id: hod.id } });
    await notifications.flushEmails();
    await notifications.flushEmails();
    const toHod = mail.sent.filter((m) => m.to === 'hod.cse@sample-college.example' && m.subject.includes('Email me this task'));
    expect(toHod).toHaveLength(1);
    expect(toHod[0]!.action?.url).toMatch(/\/tasks\?task=/);

    // The faculty member chose a 17:00 summary: nothing right away, one summary email at 17:00 IST.
    mail.sent.length = 0;
    await newTask(iqac, { title: 'Summary task one' });
    await newTask(iqac, { title: 'Summary task two' });
    await notifications.flushEmails();
    expect(mail.sent.filter((m) => m.to === 'faculty@sample-college.example')).toHaveLength(0);
    const fivePmIst = new Date(`${indiaNow().date}T11:30:00Z`);
    await notifications.sendDigests(new Date(`${indiaNow().date}T05:30:00Z`)); // 11:00 IST: nothing.
    expect(mail.sent.filter((m) => m.to === 'faculty@sample-college.example')).toHaveLength(0);
    await notifications.sendDigests(fivePmIst);
    const summary = mail.sent.filter((m) => m.to === 'faculty@sample-college.example');
    expect(summary).toHaveLength(1);
    expect(summary[0]!.text).toContain('Summary task one');
    expect(summary[0]!.text).toContain('Summary task two');
  });

  it('sends no email for an event the person switched email off for', async () => {
    await notifications.setPreferences(hod, { events: [{ event: 'task_assigned', channels: ['in_app'] }], emailDigest: 'instant' });
    mail.sent.length = 0;
    await newTask(iqac, { title: 'No email please', assignee: { kind: 'user', id: hod.id } });
    await notifications.flushEmails();
    expect(mail.sent.filter((m) => m.to === 'hod.cse@sample-college.example')).toHaveLength(0);
    expect((await inbox(hod)).items.some((n) => n.text.includes('No email please'))).toBe(true);
  });
});
