// Evidence library: who sees what, filters, version history, bulk linking and bulk download links.
// Real migrations with row-level security on; dummy files in memory; the demo criteria template.
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { createEvidenceSchema, libraryQuerySchema, resubmitEvidenceSchema, reviewSchema } from '@yucampus/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccreditationService } from '../src/accreditation/accreditation.service.js';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { AppConfig } from '../src/config.js';
import { EvidenceLibraryService } from '../src/evidence/evidence-library.service.js';
import { EvidenceService } from '../src/evidence/evidence.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { MemoryStorage } from './memory-storage.js';
import { notificationsFor } from './notifications-for.js';

let database: Database;
let prisma: PrismaService;
let storage: MemoryStorage;
let evidence: EvidenceService;
let library: EvidenceLibraryService;
let accreditation: AccreditationService;
let faculty: AuthUser;
let hod: AuthUser;
let iqac: AuthUser;
let office: AuthUser;
let otherAdmin: AuthUser;
const ids: Record<string, string> = {};

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

async function ticket(who: AuthUser, name: string, type: 'application/pdf' | 'image/png' = 'application/pdf') {
  const bytes =
    type === 'application/pdf'
      ? new TextEncoder().encode(`%PDF-1.4 ${name}`)
      : new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(name)]);
  const t = await evidence.requestUpload(who, { fileName: `${name}.${type === 'image/png' ? 'png' : 'pdf'}`, contentType: type, size: bytes.length });
  storage.put(t.url.replace('memory://', ''), bytes, type);
  return t.uploadToken;
}

async function upload(who: AuthUser, title: string, type: 'application/pdf' | 'image/png' = 'application/pdf') {
  const item = await evidence.create(who, createEvidenceSchema.parse({ uploadToken: await ticket(who, title, type), title, documentDate: '2026-08-01' }));
  return item.id;
}

const query = (q: Record<string, string> = {}) => libraryQuerySchema.parse(q);
const titles = async (who: AuthUser, q: Record<string, string> = {}) => (await library.search(who, query(q))).items.map((i) => i.title).sort();

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (client) => {
      await seed(client);
      // These tests use the demo criteria (D-codes): make it the sample college's active NAAC framework.
      const demo = await client.framework.findFirstOrThrow({ where: { code: 'NAAC_RAF', version: 'demo' } });
      const cycle = await client.assessmentCycle.findFirstOrThrow({ where: { label: 'Cycle 2', college: { subdomain: 'sample' } } });
      await client.collegeFramework.updateMany({ where: { cycleId: cycle.id }, data: { active: false } });
      await client.collegeFramework.create({ data: { collegeId: cycle.collegeId, frameworkId: demo.id, cycleId: cycle.id } });
      const other = await client.college.create({ data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' } });
      await client.user.create({
        data: { collegeId: other.id, name: 'Other Admin', email: 'admin@other-college.example', status: 'active', roles: { create: [{ collegeId: other.id, role: 'college_admin' }, { collegeId: other.id, role: 'iqac' }] } },
      });
    },
  });
  prisma = new PrismaService(database);
  storage = new MemoryStorage();
  const permissions = new PermissionsService(prisma);
  accreditation = new AccreditationService(prisma);
  evidence = new EvidenceService(prisma, storage, permissions, new AppConfig(), accreditation, notificationsFor(prisma));
  library = new EvidenceLibraryService(prisma, permissions, storage, evidence);
  faculty = await actor('sample', 'faculty@sample-college.example');
  hod = await actor('sample', 'hod.cse@sample-college.example');
  iqac = await actor('sample', 'iqac@sample-college.example');
  office = await actor('sample', 'office@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');

  ids.fdp = await upload(faculty, 'FDP certificate');
  ids.photos = await upload(faculty, 'Guest lecture photos', 'image/png');
  ids.minutes = await upload(office, 'IQAC meeting minutes');
  ids.hodPaper = await upload(hod, 'Journal paper IoT');
}, 120_000);

afterAll(() => database.close());

describe('who sees what in the library', () => {
  it('shows faculty and office staff only their own uploads', async () => {
    expect(await titles(faculty)).toEqual(['FDP certificate', 'Guest lecture photos']);
    expect(await titles(office)).toEqual(['IQAC meeting minutes']);
  });

  it('shows a HOD their department’s items and their own', async () => {
    expect(await titles(hod)).toEqual(['FDP certificate', 'Guest lecture photos', 'Journal paper IoT']);
  });

  it('shows IQAC everything in the college, and nothing to another college', async () => {
    expect(await titles(iqac)).toEqual(['FDP certificate', 'Guest lecture photos', 'IQAC meeting minutes', 'Journal paper IoT']);
    expect((await library.search(otherAdmin, query())).total).toBe(0);
  });
});

describe('filters', () => {
  it('searches titles and file names, ignoring case', async () => {
    expect(await titles(iqac, { search: 'fdp' })).toEqual(['FDP certificate']);
    expect(await titles(iqac, { search: 'meeting minutes' })).toEqual(['IQAC meeting minutes']);
  });

  it('filters by file kind, status, department and "mine"', async () => {
    expect(await titles(iqac, { kind: 'image' })).toEqual(['Guest lecture photos']);
    await evidence.review(hod, ids.fdp!, reviewSchema.parse({ decision: 'approve' }) as never);
    expect(await titles(iqac, { status: 'department_approved' })).toEqual(['FDP certificate']);
    expect(await titles(iqac, { status: 'in_review,department_approved' })).toHaveLength(4);
    const cse = (await evidence.get(iqac, ids.fdp!)).department!.id;
    expect(await titles(iqac, { departmentId: cse })).toEqual(['FDP certificate', 'Guest lecture photos', 'Journal paper IoT']);
    expect(await titles(hod, { mine: 'true' })).toEqual(['Journal paper IoT']);
  });

  it('filters by metric and by criterion, and tags each card with where it counts', async () => {
    const fdp = (await accreditation.linkableMetrics(iqac)).find((m) => m.code === 'D2.1')!;
    await evidence.setMetrics(iqac, ids.fdp!, { links: [{ metricId: fdp.id, documentKey: null }] });
    expect(await titles(iqac, { metricId: fdp.id })).toEqual(['FDP certificate']);
    expect(await titles(iqac, { criterion: `${fdp.framework.id}:2` })).toEqual(['FDP certificate']);
    expect(await titles(iqac, { criterion: `${fdp.framework.id}:3` })).toEqual([]);
    const card = (await library.search(iqac, query({ search: 'FDP' }))).items[0]!;
    expect(card.tags).toEqual(['NAAC D2.1']);
  });

  it('pages through results', async () => {
    const first = await library.search(iqac, query({ pageSize: '2' }));
    const second = await library.search(iqac, query({ pageSize: '2', page: '2' }));
    expect(first.total).toBe(4);
    expect(first.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(4);
  });
});

describe('version history', () => {
  it('keeps every file, marks the current one, and offers each for download', async () => {
    expect((await library.versions(faculty, ids.photos!)).map((v) => v.version)).toEqual([1]);
    await evidence.review(hod, ids.photos!, reviewSchema.parse({ decision: 'needs_fix', comment: 'Add the attendance sheet' }) as never);
    await evidence.resubmit(
      faculty,
      ids.photos!,
      resubmitEvidenceSchema.parse({ uploadToken: await ticket(faculty, 'Photos with attendance'), title: 'Guest lecture photos' }),
    );
    const versions = await library.versions(faculty, ids.photos!);
    expect(versions.map((v) => [v.version, v.current, v.fileName])).toEqual([
      [2, true, 'Photos with attendance.pdf'],
      [1, false, 'Guest lecture photos.png'],
    ]);
    expect((await library.versionLink(faculty, ids.photos!, 1, true)).url).toContain('inline');
    expect(await codeOf(library.versionLink(faculty, ids.photos!, 9, false))).toBe('not_found');
  });

  it('is private to people who may see the item', async () => {
    expect(await codeOf(library.versions(office, ids.photos!))).toBe('not_found');
    expect(await codeOf(library.versions(otherAdmin, ids.photos!))).toBe('not_found');
    expect(await codeOf(library.versionLink(otherAdmin, ids.photos!, 1, false))).toBe('not_found');
  });
});

describe('bulk actions', () => {
  it('links many items to a metric, skipping those already linked or not the person’s to change', async () => {
    const minutes = (await accreditation.linkableMetrics(iqac)).find((m) => m.code === 'D6.2')!;
    const result = await library.bulkLink(iqac, { evidenceIds: [ids.minutes!, ids.hodPaper!, ids.minutes!], metricId: minutes.id });
    expect(result).toEqual({ linked: 2, skipped: 0 });
    expect(await library.bulkLink(iqac, { evidenceIds: [ids.minutes!], metricId: minutes.id })).toEqual({ linked: 0, skipped: 1 });
    // Office staff cannot change the HOD's item.
    expect(await library.bulkLink(office, { evidenceIds: [ids.hodPaper!], metricId: minutes.id })).toEqual({ linked: 0, skipped: 1 });
  });

  it('refuses the whole batch when the metric needs a document choice', async () => {
    const papers = (await accreditation.linkableMetrics(iqac)).find((m) => m.code === 'D3.1')!;
    expect(await codeOf(library.bulkLink(iqac, { evidenceIds: [ids.minutes!], metricId: papers.id }))).toBe('choose_document');
  });

  it('gives download links only for items the person may see', async () => {
    const links = await library.downloadLinks(faculty, [ids.fdp!, ids.minutes!, ids.hodPaper!]);
    expect(links.map((l) => l.id)).toEqual([ids.fdp]);
    expect(links[0]!.url).toContain('download');
    expect(await codeOf(library.downloadLinks(otherAdmin, [ids.fdp!]))).toBe('not_found');
  });
});
