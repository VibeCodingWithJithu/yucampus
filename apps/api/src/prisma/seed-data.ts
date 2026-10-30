// Seeds one dummy college so the app can be explored locally. Safe to run again (it upserts).
// Everything here is made-up sample data: never put real student or faculty data in this file.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { hashPassword } from '../auth/passwords.js';
import type { PrismaClient, Role } from '../generated/prisma/client.js';
import { sarTemplateSchema } from '@yucampus/validation';
import { importRegister } from '../rules/import-register.js';
import { importTemplate } from '../rules/import-template.js';

const RULES_DIR = path.resolve(import.meta.dirname, '../../rules');
const loadTemplate = (file: string) => JSON.parse(readFileSync(path.join(RULES_DIR, file), 'utf8')) as unknown;

/** Every sample user signs in with this password, or with the OTP printed in the API console. */
export const SAMPLE_PASSWORD = 'Sample@1234';
export const SAMPLE_PLATFORM_ADMIN = { name: 'Sample YuCampus Admin', email: 'team@yucampus.example' };
export const SAMPLE_SUBDOMAIN = 'sample';

const DEPARTMENTS = [
  { code: 'CSE', name: 'Computer Science and Engineering', program: 'B.Tech Computer Science and Engineering' },
  { code: 'ECE', name: 'Electronics and Communication Engineering', program: 'B.Tech Electronics and Communication' },
  { code: 'MECH', name: 'Mechanical Engineering', program: 'B.Tech Mechanical Engineering' },
  { code: 'MBA', name: 'Management Studies', program: 'MBA' },
];

// Mobile numbers are placeholders. No SMS is ever sent to them: local OTPs are only printed in the console.
export const SAMPLE_USERS: {
  name: string;
  email: string;
  mobile: string;
  roles: { role: Role; department?: string }[];
}[] = [
  { name: 'Sample College Admin', email: 'admin@sample-college.example', mobile: '9000000001', roles: [{ role: 'college_admin' }] },
  { name: 'Sample Principal', email: 'principal@sample-college.example', mobile: '9000000002', roles: [{ role: 'principal' }] },
  { name: 'Sample IQAC Coordinator', email: 'iqac@sample-college.example', mobile: '9000000003', roles: [{ role: 'iqac' }] },
  {
    name: 'Sample HOD (CSE)',
    email: 'hod.cse@sample-college.example',
    mobile: '9000000004',
    roles: [{ role: 'hod', department: 'CSE' }, { role: 'faculty', department: 'CSE' }],
  },
  {
    name: 'Sample NBA Coordinator',
    email: 'nba@sample-college.example',
    mobile: '9000000005',
    roles: [{ role: 'nba_coord' }, { role: 'faculty', department: 'ECE' }],
  },
  { name: 'Sample NIRF Coordinator', email: 'nirf@sample-college.example', mobile: '9000000006', roles: [{ role: 'nirf_coord' }] },
  {
    name: 'Sample Faculty',
    email: 'faculty@sample-college.example',
    mobile: '9000000007',
    roles: [{ role: 'faculty', department: 'CSE' }],
  },
  { name: 'Sample Office Staff', email: 'office@sample-college.example', mobile: '9000000008', roles: [{ role: 'office' }] },
];

// Other framework choices. Names only: their criteria and metrics are loaded from the official manuals
// in roadmap slice 4 (NAAC) and Phase 2 (NBA, NIRF). Until then the app says they are not loaded yet.
// NAAC: one active per assessment cycle. NBA: chosen per program, by discipline and tier. NIRF: one per
// category, several at once.
const FRAMEWORKS = [
  { body: 'NAAC', code: 'NAAC_BINARY_MBGL', name: 'NAAC Binary Accreditation and Maturity-Based Graded Levels', selection: 'single', attachesTo: 'college' },
  { body: 'NBA', code: 'NBA_ENGG_TIER1', name: 'NBA · Engineering · Tier I', selection: 'single', attachesTo: 'program' },
  { body: 'NBA', code: 'NBA_ENGG_TIER2', name: 'NBA · Engineering · Tier II', selection: 'single', attachesTo: 'program' },
  { body: 'NBA', code: 'NBA_PHARMACY', name: 'NBA · Pharmacy', selection: 'single', attachesTo: 'program' },
  { body: 'NBA', code: 'NBA_MANAGEMENT', name: 'NBA · Management', selection: 'single', attachesTo: 'program' },
  { body: 'NIRF', code: 'NIRF_OVERALL', name: 'NIRF · Overall', selection: 'multiple', attachesTo: 'college' },
  { body: 'NIRF', code: 'NIRF_ENGINEERING', name: 'NIRF · Engineering', selection: 'multiple', attachesTo: 'college' },
  { body: 'NIRF', code: 'NIRF_MANAGEMENT', name: 'NIRF · Management', selection: 'multiple', attachesTo: 'college' },
  { body: 'NIRF', code: 'NIRF_PHARMACY', name: 'NIRF · Pharmacy', selection: 'multiple', attachesTo: 'college' },
] as const;

/** Codes from earlier seeds that are no longer offered. */
const RETIRED_CODES = ['NBA'];

export async function seed(prisma: PrismaClient): Promise<void> {
  const frameworkIds = new Map<string, string>();
  for (const { body, code, name, selection, attachesTo } of FRAMEWORKS) {
    const row = await prisma.framework.upsert({
      where: { code_version: { code, version: '1' } },
      update: { name, selection, attachesTo },
      create: { body, code, version: '1', name, status: 'draft', selection, attachesTo },
    });
    frameworkIds.set(code, row.id);
  }
  await prisma.framework.updateMany({ where: { code: { in: RETIRED_CODES } }, data: { status: 'retired' } });

  // The NBA SAR (apps/api/rules/nba/sar.json): one report template per engineering NBA format it applies to.
  const sar = sarTemplateSchema.parse(loadTemplate(path.join('nba', 'sar.json')));
  for (const code of sar.appliesTo) {
    const frameworkId = frameworkIds.get(code);
    if (!frameworkId) continue;
    const layout = { name: sar.name, description: sar.description, period: 'year', perProgram: true, criteria: sar.criteria, source: sar.source };
    await prisma.reportTemplate.upsert({
      where: { frameworkId_kind_version: { frameworkId, kind: 'SAR', version: sar.version } },
      update: { layout },
      create: { frameworkId, kind: 'SAR', version: sar.version, layout },
    });
  }

  // Criteria templates (apps/api/rules). The demo template has made-up metrics so the screens can be tried.
  // NAAC RAF templates extracted from the official manuals (apps/api/rules; not yet checked line by line),
  // and the demo template used by automated tests.
  const templates: Record<string, string> = {};
  for (const file of ['naac-raf-affiliated.json', 'naac-raf-autonomous.json', 'naac-raf-university.json', 'naac-raf-demo.json']) {
    templates[file] = (await importTemplate(prisma, loadTemplate(file))).frameworkId;
  }
  // Data register definitions (apps/api/rules/registers).
  for (const file of readdirSync(path.join(RULES_DIR, 'registers')).filter((f) => f.endsWith('.json')).sort()) {
    await importRegister(prisma, loadTemplate(path.join('registers', file)));
  }
  // The earlier criterion-names-only template is replaced by the extracted ones.
  await prisma.framework.updateMany({ where: { code: 'NAAC_RAF', version: '1' }, data: { status: 'retired' } });
  // The sample college is an affiliated college.
  const framework = { id: templates['naac-raf-affiliated.json']! };

  const college = await prisma.college.upsert({
    where: { subdomain: SAMPLE_SUBDOMAIN },
    update: {},
    create: {
      name: 'Sri Example Institute of Engineering',
      type: 'affiliated',
      subdomain: SAMPLE_SUBDOMAIN,
      state: 'Andhra Pradesh',
    },
  });
  const collegeId = college.id;

  // A NAAC cycle with RAF active. Dates are sample values.
  const cycle = await prisma.assessmentCycle.upsert({
    where: { collegeId_body_label: { collegeId, body: 'NAAC', label: 'Cycle 2' } },
    update: {},
    create: { collegeId, body: 'NAAC', label: 'Cycle 2', startDate: new Date('2024-07-01'), endDate: new Date('2029-06-30') },
  });
  // Rows from before cycles existed belong to this cycle.
  await prisma.collegeFramework.updateMany({ where: { collegeId, cycleId: null, framework: { body: 'NAAC' } }, data: { cycleId: cycle.id } });
  // The sample college works against the demo template in this cycle (one NAAC framework active per cycle).
  await prisma.collegeFramework.updateMany({
    where: { collegeId, cycleId: cycle.id, framework: { body: 'NAAC' }, frameworkId: { not: framework.id } },
    data: { active: false },
  });
  const naacRow = await prisma.collegeFramework.findFirst({ where: { collegeId, frameworkId: framework.id, cycleId: cycle.id } });
  if (naacRow) {
    if (!naacRow.active) await prisma.collegeFramework.update({ where: { id: naacRow.id }, data: { active: true, retiredAt: null } });
  } else {
    await prisma.collegeFramework.create({ data: { collegeId, frameworkId: framework.id, cycleId: cycle.id } });
  }
  // The sample college is an engineering college: it applies in NIRF Engineering.
  const nirfEngineering = frameworkIds.get('NIRF_ENGINEERING');
  if (nirfEngineering && !(await prisma.collegeFramework.findFirst({ where: { collegeId, frameworkId: nirfEngineering } }))) {
    await prisma.collegeFramework.create({ data: { collegeId, frameworkId: nirfEngineering } });
  }

  const yearsFrom = (first: number, status: 'locked' | 'current' | 'next') => ({
    label: `${first}-${String(first + 1).slice(2)}`,
    start: `${first}-07-01`,
    end: `${first + 1}-06-30`,
    status,
    terms: [
      { name: 'Odd semester', start: `${first}-07-01`, end: `${first}-12-31` },
      { name: 'Even semester', start: `${first + 1}-01-01`, end: `${first + 1}-06-30` },
    ],
  });
  const years = [yearsFrom(2025, 'locked'), yearsFrom(2026, 'current'), yearsFrom(2027, 'next')];
  for (const year of years) {
    await prisma.academicYear.upsert({
      where: { collegeId_label: { collegeId, label: year.label } },
      update: {},
      create: {
        collegeId,
        label: year.label,
        startDate: new Date(year.start),
        endDate: new Date(year.end),
        status: year.status,
        terms: year.terms,
      },
    });
  }

  const current = await prisma.academicYear.findFirstOrThrow({ where: { collegeId, status: 'current' } });
  if ((await prisma.keyDate.count({ where: { collegeId } })) === 0) {
    await prisma.keyDate.createMany({
      data: [
        { title: 'Internal IQAC audit', date: '2026-11-24', days: 7 },
        { title: 'AQAR 2025-26 submission', date: '2026-12-15', days: 30 },
      ].map(({ title, date, days }) => ({
        collegeId,
        academicYearId: current.id,
        title,
        date: new Date(date),
        reminderRule: { daysBefore: [days], channels: ['in_app', 'email'] },
      })),
    });
  }

  const departmentIds = new Map<string, string>();
  for (const { code, name, program } of DEPARTMENTS) {
    const department = await prisma.department.upsert({
      where: { collegeId_code: { collegeId, code } },
      update: { name },
      create: { collegeId, code, name },
    });
    departmentIds.set(code, department.id);
    const hasProgram = await prisma.program.findFirst({ where: { collegeId, departmentId: department.id } });
    if (!hasProgram) {
      await prisma.program.create({
        data: {
          collegeId,
          departmentId: department.id,
          name: program,
          level: code === 'MBA' ? 'PG' : 'UG',
          // Sample: B.Tech CSE is assessed by NBA under the engineering Tier II format.
          frameworks: code === 'CSE' ? { create: { collegeId, frameworkId: frameworkIds.get('NBA_ENGG_TIER2')! } } : undefined,
        },
      });
    }
  }

  let passwordHash: string | undefined;
  for (const { name, email, mobile, roles } of SAMPLE_USERS) {
    const existing = await prisma.user.findFirst({ where: { collegeId, email } });
    if (existing) continue;
    passwordHash ??= await hashPassword(SAMPLE_PASSWORD);
    const user = await prisma.user.create({
      data: { collegeId, name, email, mobile, passwordHash, status: 'active' },
    });
    await prisma.userRole.createMany({
      data: roles.map(({ role, department }) => ({
        collegeId,
        userId: user.id,
        role,
        departmentId: department ? departmentIds.get(department) : undefined,
      })),
    });
  }

  // A sample YuCampus team account for the platform panel (/admin). Dummy, like everything in the seed.
  if (!(await prisma.platformAdmin.findUnique({ where: { email: SAMPLE_PLATFORM_ADMIN.email } }))) {
    passwordHash ??= await hashPassword(SAMPLE_PASSWORD);
    await prisma.platformAdmin.create({ data: { ...SAMPLE_PLATFORM_ADMIN, passwordHash, status: 'active' } });
  }
}
