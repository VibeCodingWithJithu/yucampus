// Evidence upload and the two-level review, against the real migrations with row-level security on.
// Files are dummy bytes in an in-memory store. All people are dummy sample data.
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { createEvidenceSchema, reviewSchema } from '@yucampus/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/auth/tokens.service.js';
import { AccreditationService } from '../src/accreditation/accreditation.service.js';
import { AppConfig } from '../src/config.js';
import { EvidenceService } from '../src/evidence/evidence.service.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seed } from '../src/prisma/seed-data.js';
import { MemoryStorage } from './memory-storage.js';
import { notificationsFor } from './notifications-for.js';

const PDF = new TextEncoder().encode('%PDF-1.4\n% sample evidence\n');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

let database: Database;
let prisma: PrismaService;
let storage: MemoryStorage;
let evidence: EvidenceService;
let faculty: AuthUser;
let hod: AuthUser;
let iqac: AuthUser;
let principal: AuthUser;
let office: AuthUser;
let nba: AuthUser;
let otherAdmin: AuthUser;
let otherCollegeId: string;

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

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The whole upload as the browser does it: ask for a link, PUT the bytes, then create the evidence. */
async function upload(
  who: AuthUser,
  options: { bytes?: Uint8Array; type?: 'application/pdf' | 'image/png'; title?: string; documentDate?: string; claimedSize?: number; stored?: Uint8Array } = {},
) {
  const bytes = options.bytes ?? PDF;
  const type = options.type ?? 'application/pdf';
  const ticket = await evidence.requestUpload(who, {
    fileName: type === 'application/pdf' ? 'Certificate.pdf' : 'Photo.png',
    contentType: type,
    size: options.claimedSize ?? bytes.length,
    sha256: sha(bytes),
  });
  storage.put(ticket.url.replace('memory://', ''), options.stored ?? bytes, type);
  return evidence.create(
    who,
    createEvidenceSchema.parse({
      uploadToken: ticket.uploadToken,
      title: options.title ?? 'FDP certificate · Machine Learning',
      documentDate: options.documentDate ?? '2026-08-20',
    }),
  );
}

const decide = (who: AuthUser, id: string, input: Parameters<typeof reviewSchema.parse>[0]) =>
  evidence.review(who, id, reviewSchema.parse(input) as never);

async function setApprovalLevels(levels: 1 | 2) {
  await prisma.forTenant(faculty.collegeId, async (db) => {
    const college = await db.college.findUniqueOrThrow({ where: { id: faculty.collegeId } });
    await db.college.update({
      where: { id: faculty.collegeId },
      data: { settings: { ...(college.settings as object), approvalLevels: levels } },
    });
  });
}

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (owner) => {
      await seed(owner);
      const other = await owner.college.create({
        data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' },
      });
      otherCollegeId = other.id;
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
  evidence = new EvidenceService(prisma, storage, new PermissionsService(prisma), new AppConfig(), new AccreditationService(prisma), notificationsFor(prisma));
  faculty = await actor('sample', 'faculty@sample-college.example');
  hod = await actor('sample', 'hod.cse@sample-college.example');
  iqac = await actor('sample', 'iqac@sample-college.example');
  principal = await actor('sample', 'principal@sample-college.example');
  office = await actor('sample', 'office@sample-college.example');
  nba = await actor('sample', 'nba@sample-college.example');
  otherAdmin = await actor('other', 'admin@other-college.example');
}, 120_000);

afterAll(() => database.close());

describe('uploading', () => {
  it('creates evidence for the uploader’s department in the current year, waiting for the HOD', async () => {
    const item = await upload(faculty);
    expect(item).toMatchObject({ status: 'in_review', department: { code: 'CSE' }, academicYear: '2026-27', version: 1, fileName: 'Certificate.pdf' });
    expect(item.stage).toMatchObject({ waitingFor: 'department', label: 'Waiting for HOD' });
    expect(item.history.map((h) => h.action)).toEqual(['submitted']);
    expect(item.can).toEqual({ review: null, resubmit: false, linkMetrics: true });
  });

  it('refuses people whose role cannot upload (the principal, by default)', async () => {
    const request = evidence.requestUpload(principal, { fileName: 'a.pdf', contentType: 'application/pdf', size: 10 });
    expect(await codeOf(request)).toBe('forbidden');
  });

  it('refuses a file that is not really what it claims to be, and deletes it', async () => {
    const before = storage.files.size;
    expect(await codeOf(upload(faculty, { bytes: HTML }))).toBe('file_rejected');
    expect(storage.files.size).toBe(before);
  });

  it('refuses a stored file of a different size than was approved', async () => {
    expect(await codeOf(upload(faculty, { stored: new Uint8Array([...PDF, 1, 2, 3]) }))).toBe('file_rejected');
  });

  it('refuses an upload that never arrived', async () => {
    const ticket = await evidence.requestUpload(faculty, { fileName: 'a.pdf', contentType: 'application/pdf', size: PDF.length });
    const input = createEvidenceSchema.parse({ uploadToken: ticket.uploadToken, title: 'Never uploaded' });
    expect(await codeOf(evidence.create(faculty, input))).toBe('upload_missing');
  });

  it('does not accept someone else’s upload token, or a tampered one', async () => {
    const ticket = await evidence.requestUpload(faculty, { fileName: 'a.pdf', contentType: 'application/pdf', size: PDF.length });
    storage.put(ticket.url.replace('memory://', ''), PDF, 'application/pdf');
    const input = createEvidenceSchema.parse({ uploadToken: ticket.uploadToken, title: 'Borrowed token' });
    expect(await codeOf(evidence.create(hod, input))).toBe('upload_expired');
    expect(await codeOf(evidence.create(otherAdmin, input))).toBe('upload_expired');
    const tampered = createEvidenceSchema.parse({ uploadToken: `${ticket.uploadToken.slice(0, -3)}abc`, title: 'Tampered' });
    expect(await codeOf(evidence.create(faculty, tampered))).toBe('upload_expired');
  });

  it('lets people upload only for their own department', async () => {
    const departments = await prisma.forTenant(faculty.collegeId, (db) => db.department.findMany({ where: { collegeId: faculty.collegeId } }));
    const ece = departments.find((d) => d.code === 'ECE')!;
    const ticket = await evidence.requestUpload(faculty, { fileName: 'a.pdf', contentType: 'application/pdf', size: PDF.length });
    storage.put(ticket.url.replace('memory://', ''), PDF, 'application/pdf');
    const input = createEvidenceSchema.parse({ uploadToken: ticket.uploadToken, title: 'For ECE', departmentId: ece.id });
    expect(await codeOf(evidence.create(faculty, input))).toBe('forbidden');
  });

  it('files college-wide roles’ uploads under no department, straight to final approval', async () => {
    const item = await upload(office, { title: 'Infrastructure photos', bytes: PNG, type: 'image/png' });
    expect(item.department).toBeNull();
    expect(item.stage.waitingFor).toBe('final');
  });
});

describe('two-level approval', () => {
  it('goes faculty → HOD → IQAC, each only at their own level', async () => {
    const item = await upload(faculty, { title: 'Guest lecture report' });

    expect((await evidence.queue(hod)).items.map((i) => i.id)).toContain(item.id);
    expect((await evidence.queue(iqac)).items.map((i) => i.id)).not.toContain(item.id);
    expect(await codeOf(decide(iqac, item.id, { decision: 'approve' }))).toBe('not_your_turn');

    const afterHod = await decide(hod, item.id, { decision: 'approve' });
    expect(afterHod.status).toBe('department_approved');
    expect(afterHod.stage.waitingFor).toBe('final');
    expect((await evidence.queue(hod)).items.map((i) => i.id)).not.toContain(item.id);
    expect(await codeOf(decide(hod, item.id, { decision: 'approve' }))).toBe('not_your_turn');

    expect((await evidence.queue(iqac)).items.map((i) => i.id)).toContain(item.id);
    const final = await decide(iqac, item.id, { decision: 'approve', title: 'Guest lecture report (corrected)' });
    expect(final).toMatchObject({ status: 'approved', title: 'Guest lecture report (corrected)' });
    expect(final.history.map((h) => [h.action, h.level])).toEqual([
      ['submitted', null],
      ['approved', 'department'],
      ['approved', 'final'],
    ]);
    expect(await codeOf(decide(iqac, item.id, { decision: 'reject', comment: 'late' }))).toBe('not_your_turn');
  });

  it('never lets anyone approve their own upload', async () => {
    const mine = await upload(iqac, { title: 'IQAC minutes' });
    expect((await evidence.queue(iqac)).items.map((i) => i.id)).not.toContain(mine.id);
    expect(await codeOf(decide(iqac, mine.id, { decision: 'approve' }))).toBe('own_upload');
  });

  it('sends a HOD’s own upload straight to final approval instead of waiting for themselves', async () => {
    const item = await upload(hod, { title: 'Department board minutes' });
    expect(item.stage.waitingFor).toBe('final');
    expect((await evidence.queue(iqac)).items.map((i) => i.id)).toContain(item.id);
  });

  it('gives the NBA coordinator nothing until evidence is linked to NBA criteria', async () => {
    expect((await evidence.queue(nba)).total).toBe(0);
  });
});

describe('sending back and rejecting', () => {
  it('needs a comment to send back or reject', () => {
    expect(reviewSchema.safeParse({ decision: 'needs_fix' }).success).toBe(false);
    expect(reviewSchema.safeParse({ decision: 'reject', comment: '  ' }).success).toBe(false);
  });

  it('lets the uploader fix and resend, with a new version of the file', async () => {
    const item = await upload(faculty, { title: 'Workshop photos', bytes: PNG, type: 'image/png' });
    const back = await decide(hod, item.id, { decision: 'needs_fix', comment: 'Please add the attendance sheet' });
    expect(back.status).toBe('needs_fix');

    const own = await evidence.get(faculty, item.id);
    expect(own.can.resubmit).toBe(true);
    expect(await codeOf(evidence.resubmit(hod, item.id, { title: 'x' }))).toBe('forbidden');

    const ticket = await evidence.requestUpload(faculty, { fileName: 'With attendance.pdf', contentType: 'application/pdf', size: PDF.length });
    storage.put(ticket.url.replace('memory://', ''), PDF, 'application/pdf');
    const again = await evidence.resubmit(faculty, item.id, { uploadToken: ticket.uploadToken, title: 'Workshop photos and attendance' });
    expect(again).toMatchObject({ status: 'in_review', version: 2, fileName: 'With attendance.pdf' });
    expect(again.history.map((h) => h.action)).toEqual(['submitted', 'needs_fix', 'resubmitted']);
    expect(await codeOf(evidence.resubmit(faculty, item.id, { title: 'again' }))).toBe('not_sent_back');
  });

  it('ends at "rejected", which the uploader cannot resend', async () => {
    const item = await upload(faculty, { title: 'Unrelated file' });
    const rejected = await decide(hod, item.id, { decision: 'reject', comment: 'Not accreditation evidence' });
    expect(rejected.status).toBe('rejected');
    expect((await evidence.get(faculty, item.id)).can.resubmit).toBe(false);
  });
});

describe('one approval level', () => {
  it('sends department uploads straight to IQAC', async () => {
    await setApprovalLevels(1);
    try {
      const item = await upload(faculty, { title: 'One-level item' });
      expect(item.stage.waitingFor).toBe('final');
      expect((await evidence.queue(hod)).items.map((i) => i.id)).not.toContain(item.id);
      expect((await decide(iqac, item.id, { decision: 'approve' })).status).toBe('approved');
    } finally {
      await setApprovalLevels(2);
    }
  });
});

describe('who can see evidence', () => {
  it('shows it to the uploader, the reviewers and the principal, not to others', async () => {
    const item = await upload(faculty, { title: 'Visibility check' });
    for (const who of [faculty, hod, iqac, principal]) {
      expect((await evidence.get(who, item.id)).id).toBe(item.id);
    }
    expect(await codeOf(evidence.get(office, item.id))).toBe('not_found');
  });

  it('never shows or changes another college’s evidence', async () => {
    const item = await upload(faculty, { title: 'Tenant check' });
    expect(await codeOf(evidence.get(otherAdmin, item.id))).toBe('not_found');
    expect(await codeOf(decide(otherAdmin, item.id, { decision: 'approve' }))).toBe('not_found');
    expect(await codeOf(evidence.fileLink(otherAdmin, item.id, true))).toBe('not_found');
    expect((await evidence.queue(otherAdmin)).items.map((i) => i.id)).not.toContain(item.id);
    const otherRows = await prisma.forTenant(otherCollegeId, (db) => db.evidence.count({ where: { collegeId: otherCollegeId } }));
    expect(otherRows).toBe(0);
  });

  it('gives a viewing link inline for previews and as a download otherwise', async () => {
    const item = await upload(faculty, { title: 'Link check' });
    expect((await evidence.fileLink(iqac, item.id, true)).url).toContain('inline');
    expect((await evidence.fileLink(iqac, item.id, false)).url).toContain('download');
  });
});

describe('automatic checks for reviewers', () => {
  it('warns about a duplicate file and a date outside the academic year', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 the same certificate twice');
    await upload(faculty, { bytes, title: 'First copy' });
    const second = await upload(faculty, { bytes, title: 'Second copy', documentDate: '2024-01-10' });
    const detail = await evidence.get(hod, second.id);
    const byKey = Object.fromEntries(detail.checks.map((c) => [c.key, c]));
    expect(byKey.duplicate).toMatchObject({ ok: false });
    expect(byKey.duplicate!.text).toContain('First copy');
    expect(byKey.date).toMatchObject({ ok: false });
    expect(byKey.file).toMatchObject({ ok: true });
  });

  it('passes a unique file dated inside the year', async () => {
    const item = await upload(faculty, { bytes: new TextEncoder().encode('%PDF-1.4 unique'), title: 'Unique' });
    expect((await evidence.get(hod, item.id)).checks.every((c) => c.ok)).toBe(true);
  });
});

describe('my uploads', () => {
  it('counts the uploader’s items by status', async () => {
    const mine = await evidence.mine(faculty);
    expect(mine.counts.uploaded).toBe(mine.items.length);
    expect(mine.counts.approved).toBeGreaterThan(0);
    expect(mine.counts.inReview).toBeGreaterThan(0);
    expect(mine.items.every((item) => item.uploadedBy.id === faculty.id)).toBe(true);
  });
});
