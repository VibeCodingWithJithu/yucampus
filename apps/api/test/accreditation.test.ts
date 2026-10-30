// Criteria templates, linking evidence to metrics, and readiness. Real migrations, row-level security on.
// Uses the demo template (made-up metrics) and dummy files.
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HttpException } from '@nestjs/common';
import { createEvidenceSchema, reviewSchema } from '@yucampus/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccreditationService } from '../src/accreditation/accreditation.service.js';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { AppConfig } from '../src/config.js';
import { EvidenceService } from '../src/evidence/evidence.service.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { TemplateImportError, importTemplate } from '../src/rules/import-template.js';
import { MemoryStorage } from './memory-storage.js';
import { notificationsFor } from './notifications-for.js';

const RULES = path.resolve(import.meta.dirname, '../rules');
const demoTemplate = () => JSON.parse(readFileSync(path.join(RULES, 'naac-raf-demo.json'), 'utf8')) as Record<string, unknown>;
const PDF = new TextEncoder().encode('%PDF-1.4 dummy');

let database: Database;
let owner: PrismaClient;
let prisma: PrismaService;
let accreditation: AccreditationService;
let evidence: EvidenceService;
let storage: MemoryStorage;
let faculty: AuthUser;
let hod: AuthUser;
let iqac: AuthUser;
let nba: AuthUser;
let principal: AuthUser;
let otherAdmin: AuthUser;

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

async function upload(who: AuthUser, title: string, link?: { metricId: string; documentKey?: string }) {
  const bytes = new TextEncoder().encode(`%PDF-1.4 ${title}`);
  const ticket = await evidence.requestUpload(who, { fileName: `${title}.pdf`, contentType: 'application/pdf', size: bytes.length });
  storage.put(ticket.url.replace('memory://', ''), bytes, 'application/pdf');
  return evidence.create(
    who,
    createEvidenceSchema.parse({ uploadToken: ticket.uploadToken, title, documentDate: '2026-08-01', metricId: link?.metricId, documentKey: link?.documentKey }),
  );
}
/** Runs as the database owner (rules are read-only for the app role), then drops back to the app role. */
async function asOwner<T>(work: () => Promise<T>): Promise<T> {
  await owner.$executeRawUnsafe('RESET ROLE');
  try {
    return await work();
  } finally {
    await owner.$executeRawUnsafe('SET ROLE yucampus_app');
  }
}

const approve = (who: AuthUser, id: string) => evidence.review(who, id, reviewSchema.parse({ decision: 'approve' }) as never);

async function metricByCode(code: string) {
  const metrics = await accreditation.linkableMetrics(iqac);
  return metrics.find((m) => m.code === code)!;
}

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (client) => {
      owner = client;
      await seed(client);
      const other = await client.college.create({
        data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' },
      });
      await client.user.create({
        data: {
          collegeId: other.id,
          name: 'Other College Admin',
          email: 'admin@other-college.example',
          status: 'active',
          roles: { create: [{ collegeId: other.id, role: 'college_admin' }] },
        },
      });
      // These tests are written for the small demo template: make it the sample college's NAAC framework in Cycle 2.
      const demo = await client.framework.findFirstOrThrow({ where: { code: 'NAAC_RAF', version: 'demo' } });
      const cycle2 = await client.assessmentCycle.findFirstOrThrow({ where: { label: 'Cycle 2', college: { subdomain: 'sample' } } });
      await client.collegeFramework.updateMany({ where: { cycleId: cycle2.id }, data: { active: false } });
      await client.collegeFramework.create({ data: { collegeId: cycle2.collegeId, frameworkId: demo.id, cycleId: cycle2.id } });
      // A criterion-names-only template, to show criteria whose metrics are not loaded yet.
      await importTemplate(client, {
        ...demoTemplate(),
        code: 'NAAC_NAMES_TEST',
        version: '1',
        name: 'Names only',
        criteria: (demoTemplate().criteria as { number: number; name: string }[]).map(({ number, name }) => ({ number, name })),
      });
      // Tests below need the owner role (rules are read-only for the app): import while still owner.
      const tierOne = { ...demoTemplate(), body: 'NBA', code: 'NBA_TEST', version: 'demo', name: 'NBA test template', attachesTo: 'program' };
      await importTemplate(client, tierOne);
      const nbaFramework = await client.framework.findFirstOrThrow({ where: { code: 'NBA_TEST' } });
      const cseProgram = await client.program.findFirstOrThrow({ where: { department: { code: 'CSE' } } });
      await client.programFramework.updateMany({ where: { programId: cseProgram.id }, data: { active: false } });
      await client.programFramework.create({ data: { collegeId: cseProgram.collegeId, programId: cseProgram.id, frameworkId: nbaFramework.id } });
    },
  });
  prisma = new PrismaService(database);
  storage = new MemoryStorage();
  const permissions = new PermissionsService(prisma);
  accreditation = new AccreditationService(prisma);
  evidence = new EvidenceService(prisma, storage, permissions, new AppConfig(), accreditation, notificationsFor(prisma));
  faculty = await actor('sample', 'faculty@sample-college.example');
  hod = await actor('sample', 'hod.cse@sample-college.example');
  iqac = await actor('sample', 'iqac@sample-college.example');
  nba = await actor('sample', 'nba@sample-college.example');
  principal = await actor('sample', 'principal@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');
}, 120_000);

afterAll(() => database.close());

describe('template import', () => {
  it('cannot be run by the app itself: rules are read-only for it', async () => {
    await expect(importTemplate(owner, demoTemplate())).rejects.toThrow();
  });

  it('refuses an invalid template and explains why', async () => {
    const broken = { ...demoTemplate(), code: 'bad code', criteria: [] };
    await expect(asOwner(() => importTemplate(owner, broken))).rejects.toThrow(TemplateImportError);
    await expect(asOwner(() => importTemplate(owner, broken))).rejects.toThrow(/code/);
  });

  it('refuses to make an unverified template active', async () => {
    const active = { ...demoTemplate(), version: 'demo-2', status: 'active' };
    await expect(asOwner(() => importTemplate(owner, active))).rejects.toThrow(/verified/);
  });

  it('is safe to run again, and never changes an active version in place', async () => {
    const again = await asOwner(() => importTemplate(owner, demoTemplate()));
    expect(again).toMatchObject({ created: false, criteria: 7, metrics: 15 });

    const verified = { ...demoTemplate(), version: 'locked-test', status: 'active', source: { title: 'Test', verified: true } };
    await asOwner(() => importTemplate(owner, verified));
    await expect(asOwner(() => importTemplate(owner, verified))).rejects.toThrow(/new version/);
  });
});

describe('the NAAC overview', () => {
  it('starts at 0% with every demo criterion listed and flagged as unverified', async () => {
    const overview = (await accreditation.overview(principal, 'NAAC'))!;
    expect(overview.framework).toMatchObject({ code: 'NAAC_RAF', version: 'demo', verified: false });
    expect(overview.cycle?.label).toBe('Cycle 2');
    expect(overview.criteria).toHaveLength(7);
    expect(overview.percent).toBe(0);
    expect(overview.criteria.every((c) => c.status === 'needs_attention' && !c.pending)).toBe(true);
    expect(overview.attention.length).toBeGreaterThan(0);
  });

  it('shows "loads from the manual" for criteria without metrics', async () => {
    const raf = await prisma.forTenant(principal.collegeId, (db) => db.framework.findFirstOrThrow({ where: { code: 'NAAC_NAMES_TEST', version: '1' } }));
    // Make the names-only template active alongside, in another cycle, to view it.
    const cycle = await prisma.forTenant(principal.collegeId, (db) =>
      db.assessmentCycle.create({ data: { collegeId: principal.collegeId, body: 'NAAC', label: 'Old cycle', startDate: new Date('2019-07-01') } }),
    );
    await prisma.forTenant(principal.collegeId, (db) =>
      db.collegeFramework.create({ data: { collegeId: principal.collegeId, frameworkId: raf.id, cycleId: cycle.id } }),
    );
    const overview = (await accreditation.overview(principal, 'NAAC', raf.id))!;
    expect(overview.framework.version).toBe('1');
    expect(overview.criteria.every((c) => c.pending)).toBe(true);
    expect(overview.others.map((f) => f.version)).toEqual(['demo']);
  });

  it('is only for colleges that chose a framework of that body', async () => {
    expect(await accreditation.overview(otherAdmin, 'NAAC')).toBeNull();
  });
});

describe('linking evidence to metrics and readiness', () => {
  it('counts only finally approved evidence, document by document', async () => {
    const fdp = await metricByCode('D2.1'); // one document
    const item = await upload(faculty, 'FDP certificate', { metricId: fdp.id });
    expect(item.metrics).toEqual([expect.objectContaining({ code: 'D2.1', documentKey: 'fdp-certificates', body: 'NAAC' })]);

    let detail = await accreditation.metric(principal, fdp.id);
    expect(detail.percent).toBe(0);
    expect(detail.documents[0]).toMatchObject({ satisfied: false, approved: 0, pending: 1 });

    await approve(hod, item.id);
    expect((await accreditation.metric(principal, fdp.id)).percent).toBe(0); // HOD approval alone does not count
    await approve(iqac, item.id);
    detail = await accreditation.metric(principal, fdp.id);
    expect(detail).toMatchObject({ percent: 100, status: 'on_track' });
    expect(detail.evidence[0]).toMatchObject({ title: 'FDP certificate', counts: true });

    const overview = (await accreditation.overview(principal, 'NAAC'))!;
    const c2 = overview.criteria.find((c) => c.number === 2)!;
    expect(c2).toMatchObject({ metricsComplete: 1, metricsTotal: 3, evidence: 1, percent: 33 });
    expect(overview.percent).toBeGreaterThan(0);
  });

  it('needs to know which document it is when a metric needs several', async () => {
    const papers = await metricByCode('D3.1');
    expect(await codeOf(upload(faculty, 'Paper', { metricId: papers.id }))).toBe('choose_document');
    const item = await upload(faculty, 'Paper first page', { metricId: papers.id, documentKey: 'paper-first-page' });
    expect(item.metrics[0]?.documentName).toBe('First page of each paper');
    expect(await codeOf(upload(faculty, 'Wrong doc', { metricId: papers.id, documentKey: 'nope' }))).toBe('invalid_input');
  });

  it('refuses metrics of frameworks the college does not work against', async () => {
    const inactive = await prisma.forTenant(iqac.collegeId, (db) =>
      db.metric.findFirstOrThrow({ where: { criterion: { framework: { code: 'NAAC_RAF', version: 'locked-test' } } } }),
    );
    expect(await codeOf(upload(faculty, 'Inactive metric', { metricId: inactive.id }))).toBe('invalid_input');
  });

  it('lets the uploader relink before approval, reviewers when it is their turn, and records it', async () => {
    const minutes = await metricByCode('D6.2');
    const ict = await metricByCode('D2.2');
    const item = await upload(faculty, 'Some upload');
    expect(item.metrics).toEqual([]);
    const linked = await evidence.setMetrics(faculty, item.id, { links: [{ metricId: minutes.id }] });
    expect(linked.metrics.map((m) => m.code)).toEqual(['D6.2']);
    expect(linked.history.at(-1)?.action).toBe('remapped');

    // Not the office's turn and not their upload.
    const office = await actor('sample', 'office@sample-college.example');
    expect(await codeOf(evidence.setMetrics(office, item.id, { links: [] }))).toBe('not_found');
    // The HOD may relink while it waits for them.
    const relinked = await evidence.setMetrics(hod, item.id, { links: [{ metricId: ict.id, documentKey: 'ict-list' }] });
    expect(relinked.metrics.map((m) => m.code)).toEqual(['D2.2']);

    await approve(hod, item.id);
    await approve(iqac, item.id);
    expect(await codeOf(evidence.setMetrics(faculty, item.id, { links: [] }))).toBe('forbidden');
    // A final approver can still correct it afterwards.
    expect((await evidence.setMetrics(iqac, item.id, { links: [{ metricId: minutes.id }] })).metrics[0]?.code).toBe('D6.2');
  });

  it('lets the NBA coordinator give final approval to NBA evidence only', async () => {
    const nbaMetric = (await accreditation.linkableMetrics(iqac)).find((m) => m.framework.body === 'NBA' && m.code === 'D2.1')!;
    const naacMetric = await metricByCode('D2.1');
    const nbaItem = await upload(faculty, 'NBA evidence', { metricId: nbaMetric.id });
    const naacItem = await upload(faculty, 'NAAC evidence', { metricId: naacMetric.id });
    await approve(hod, nbaItem.id);
    await approve(hod, naacItem.id);

    const queue = (await evidence.queue(nba)).items.map((i) => i.id);
    expect(queue).toContain(nbaItem.id);
    expect(queue).not.toContain(naacItem.id);
    expect(await codeOf(approve(nba, naacItem.id))).toBe('not_your_turn');
    expect((await approve(nba, nbaItem.id)).status).toBe('approved');
  });

  it('keeps comments on a metric and never shows another college’s metric data', async () => {
    const fdp = await metricByCode('D2.1');
    const withComment = await accreditation.addComment(iqac, fdp.id, 'Please add the 2025 FDPs too');
    expect(withComment.comments.at(-1)).toMatchObject({ by: 'Sample IQAC Coordinator', body: 'Please add the 2025 FDPs too' });
    expect(await codeOf(accreditation.metric(otherAdmin, fdp.id))).toBe('not_found');
  });
});
