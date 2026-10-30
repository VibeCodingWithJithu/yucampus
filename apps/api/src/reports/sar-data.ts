// The NBA SAR for one program and academic year (docs/PRODUCT.md "NBA outcomes", SAR). Built once as a list of
// blocks (headings, text, tables) that the Word, PDF and Excel renderers lay out. Only what YuCampus holds is used:
// locked courses for attainment, register records for the data tables. A gap is written as a gap, never filled in.

import type { RegisterValue } from '@yucampus/types';
import { type SarTemplate, sarTemplateSchema } from '@yucampus/validation';
import { averageOf, coAttainment, poAttainment, rulesOf } from '../nba/attainment.js';
import { profileOf } from '../nba/nba.service.js';
import type { TenantClient } from '../prisma/prisma.service.js';
import { ReportDataError } from './report-data.js';

export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; pageBreak?: boolean }
  | { kind: 'text'; text: string; tone?: 'muted' | 'warning' | 'missing' }
  /** `sheet` puts the table in the Excel workbook too; `only` keeps it to the document or the workbook. */
  | { kind: 'table'; columns: string[]; rows: string[][]; sheet?: string; only?: 'document' | 'workbook' };

export interface SarModel {
  title: string;
  label: string;
  collegeName: string;
  programName: string;
  generatedAt: Date;
  generatedBy: string;
  verified: boolean;
  blocks: Block[];
  /** Everything still missing, by criterion, for the missing-items list and the checks. */
  gaps: { criterion: number; text: string }[];
}

export interface SarRequest {
  collegeId: string;
  templateId: string;
  programId: string;
  academicYearId?: string | null;
  createdById: string;
}

export const MISSING = 'Missing';
const yearLabel = (label: string) => label.replace('-', '–');
const num = (value: RegisterValue | undefined) => (typeof value === 'number' ? value : null);
const cell = (value: number | null, unit = '') => (value === null ? MISSING : `${value.toLocaleString('en-IN')}${unit}`);
const two = (value: number | null) => (value === null ? '–' : value.toFixed(2));

/** The SAR layout stored on a report template; null when it is not a SAR. */
export function sarLayout(layout: unknown): (SarTemplate & { period: string }) | null {
  const raw = layout as { perProgram?: boolean; criteria?: unknown; name?: string; description?: string; source?: unknown } | null;
  if (!raw?.perProgram) return null;
  const parsed = sarTemplateSchema.safeParse({ code: 'SAR', version: '1', appliesTo: ['SAR'], ...raw });
  return parsed.success ? { ...parsed.data, period: 'year' } : null;
}

export async function buildSarModel(db: TenantClient, request: SarRequest): Promise<SarModel> {
  const { collegeId } = request;
  const template = await db.reportTemplate.findUnique({ where: { id: request.templateId }, include: { framework: true } });
  const layout = template ? sarLayout(template.layout) : null;
  if (!template || !layout) throw new ReportDataError('That report format no longer exists.');
  const program = await db.program.findFirst({
    where: { id: request.programId, collegeId },
    include: { department: true, frameworks: { where: { active: true, frameworkId: template.frameworkId } } },
  });
  if (!program) throw new ReportDataError('That program no longer exists.');
  if (program.frameworks.length === 0) throw new ReportDataError(`${program.name} does not use ${template.framework.name} any more.`);

  const years = await db.academicYear.findMany({ where: { collegeId }, orderBy: { startDate: 'asc' } });
  const year = request.academicYearId ? years.find((y) => y.id === request.academicYearId) : years.find((y) => y.status === 'current');
  if (!year) throw new ReportDataError('Choose the academic year for this report.');
  // Data tables cover this year and the two before it, oldest first (as SAR tables do).
  const span = years.filter((y) => y.status !== 'next' && y.startDate <= year.startDate).slice(-3);
  const spanIds = span.map((y) => y.id);
  const labelOf = new Map(years.map((y) => [y.id, yearLabel(y.label)]));

  const [college, creator, outcomes, courses, definitions] = await Promise.all([
    db.college.findUniqueOrThrow({ where: { id: collegeId }, select: { name: true } }),
    db.user.findFirst({ where: { id: request.createdById, collegeId }, select: { name: true } }),
    db.programOutcome.findMany({ where: { programId: program.id }, orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] }),
    db.course.findMany({
      where: { collegeId, programId: program.id, academicYearId: year.id },
      include: { outcomes: { include: { mappings: true, results: true }, orderBy: { sortOrder: 'asc' } }, teacher: { select: { name: true } } },
      orderBy: [{ semester: 'asc' }, { code: 'asc' }],
    }),
    db.registerDefinition.findMany({ select: { id: true, code: true } }),
  ]);
  const idsOf = (code: string) => definitions.filter((d) => d.code === code).map((d) => d.id);
  const recordsOf = (code: string, departmentOnly: boolean) =>
    db.registerRecord.findMany({
      where: { collegeId, definitionId: { in: idsOf(code) }, academicYearId: { in: spanIds }, ...(departmentOnly ? { departmentId: program.departmentId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  const [faculty, research, facilities, batches] = await Promise.all([
    recordsOf('FACULTY', true),
    recordsOf('RESEARCH', true),
    recordsOf('INFRA_FINANCE', true),
    recordsOf('STUDENT_BATCHES', false).then((rows) => rows.filter((r) => (r.data as Record<string, RegisterValue>).program === program.id)),
  ]);

  const rules = rulesOf(program.nbaSettings);
  const profile = profileOf(program.nbaProfile);
  const label = `NBA SAR ${program.name} ${yearLabel(year.label)}`;
  const blocks: Block[] = [];
  const gaps: SarModel['gaps'] = [];
  const gap = (criterion: number, text: string) => {
    gaps.push({ criterion, text });
    blocks.push({ kind: 'text', text, tone: 'missing' });
  };

  blocks.push(
    { kind: 'title', text: college.name },
    { kind: 'heading', level: 1, text: `${layout.name} · ${program.name}` },
    { kind: 'text', text: `${template.framework.name} · ${program.department.name} · academic year ${yearLabel(year.label)}${span.length > 1 ? ` (data tables ${labelOf.get(span[0]!.id)} to ${labelOf.get(span[span.length - 1]!.id)})` : ''}` },
    { kind: 'text', text: `Created ${new Date().toISOString().slice(0, 10)} by ${creator?.name ?? 'Someone'}. Compiled from YuCampus: locked courses, approved register data and the program's own entries. Nothing has been filled in or estimated.`, tone: 'muted' },
  );
  if (!layout.source.verified) blocks.push({ kind: 'text', text: `Not yet checked against the official format. ${layout.source.title}`, tone: 'warning' });
  // The criteria summary goes here, once the gaps are known.
  const summaryAt = blocks.length;

  for (const criterion of layout.criteria) {
    blocks.push({ kind: 'heading', level: 1, text: `Criterion ${criterion.number}: ${criterion.name}`, pageBreak: true });
    switch (criterion.compiles) {
      case 'profile': {
        blocks.push({ kind: 'heading', level: 2, text: 'Vision' });
        if (profile.vision) blocks.push({ kind: 'text', text: profile.vision });
        else gap(1, 'The vision is not entered (NBA page, Vision, mission and PEOs).');
        blocks.push({ kind: 'heading', level: 2, text: 'Mission' });
        if (profile.mission) blocks.push({ kind: 'text', text: profile.mission });
        else gap(1, 'The mission is not entered.');
        blocks.push({ kind: 'heading', level: 2, text: 'Program educational objectives' });
        if (profile.peos.length) blocks.push({ kind: 'table', columns: ['PEO', 'Objective'], rows: profile.peos.map((p) => [p.code, p.statement]), sheet: 'C1 PEOs' });
        else gap(1, 'No program educational objectives (PEOs) are entered.');
        break;
      }
      case 'courses': {
        if (courses.length === 0) {
          gap(2, `No courses are entered for ${yearLabel(year.label)}.`);
          break;
        }
        blocks.push({
          kind: 'table',
          columns: ['Semester', 'Code', 'Course', 'Teacher', 'Status'],
          rows: courses.map((c) => [c.semester ? String(c.semester) : '–', c.code, c.name, c.teacher?.name ?? MISSING, c.status === 'locked' ? 'Locked' : 'Draft']),
          sheet: 'C2 Courses',
        });
        const noTeacher = courses.filter((c) => !c.teacherId).length;
        if (noTeacher) gap(2, `${noTeacher} course${noTeacher === 1 ? ' has' : 's have'} no teacher assigned.`);
        break;
      }
      case 'outcomes': {
        blocks.push({
          kind: 'text',
          text: `Attainment rules: target mark ${rules.targetMarkPercent}%; level 3 at ${rules.levels.level3}% of students, 2 at ${rules.levels.level2}%, 1 at ${rules.levels.level1}%; direct = ${rules.internalWeight}% internal + ${rules.endExamWeight}% end exam; final = ${rules.directWeight}% direct + ${rules.indirectWeight}% indirect; CO target ${rules.coTarget}. Only locked courses count.`,
          tone: 'muted',
        });
        blocks.push({ kind: 'heading', level: 2, text: 'Program outcomes and program-specific outcomes' });
        if (outcomes.length) blocks.push({ kind: 'table', columns: ['Outcome', 'Statement'], rows: outcomes.map((o) => [o.code, o.statement]), sheet: 'C3 Outcomes' });
        else gap(3, 'The program has no outcomes loaded.');
        if (!outcomes.some((o) => o.kind === 'PSO')) gap(3, 'No program-specific outcomes (PSOs) are entered.');

        const locked = courses.filter((c) => c.status === 'locked');
        const unlocked = courses.length - locked.length;
        if (courses.length === 0) gap(3, 'No courses, so no course outcomes or attainment.');
        else if (unlocked) gap(3, `${unlocked} course${unlocked === 1 ? ' is' : 's are'} not locked yet and ${unlocked === 1 ? 'does' : 'do'} not count.`);
        const perCourse = locked.map((course) => {
          const cos = course.outcomes.map((o) => ({
            ...o,
            attainment: coAttainment(o.results, o.indirectLevel, rules),
            mapping: Object.fromEntries(o.mappings.map((m) => [m.programOutcomeId, m.strength])),
          }));
          return { course, cos };
        });
        const coRows: string[][] = [];
        const mapRows: string[][] = [];
        for (const { course, cos } of perCourse) {
          blocks.push({ kind: 'heading', level: 3, text: `${course.code} · ${course.name}` });
          if (cos.length === 0) {
            gap(3, `${course.code} has no course outcomes.`);
            continue;
          }
          const rows = cos.map((o) => [
            o.code,
            o.statement,
            two(o.attainment.direct),
            two(o.attainment.indirect),
            o.attainment.final === null ? MISSING : two(o.attainment.final),
            o.attainment.meetsTarget === null ? '–' : o.attainment.meetsTarget ? 'Yes' : 'No',
          ]);
          blocks.push({ kind: 'table', columns: ['CO', 'Statement', 'Direct', 'Indirect', 'Final', 'Target met'], rows, only: 'document' });
          coRows.push(...rows.map((r) => [course.code, ...r]));
          const matrix = cos.map((o) => [o.code, ...outcomes.map((po) => (o.mapping[po.id] ? String(o.mapping[po.id]) : '–'))]);
          blocks.push({ kind: 'table', columns: ['CO', ...outcomes.map((o) => o.code)], rows: matrix, only: 'document' });
          mapRows.push(...matrix.map((r) => [course.code, ...r]));
          for (const o of cos.filter((c) => c.attainment.waitingFor)) gap(3, `${course.code} ${o.code}: waiting for ${o.attainment.waitingFor}.`);
        }
        if (coRows.length) {
          blocks.push({ kind: 'table', columns: ['Course', 'CO', 'Statement', 'Direct', 'Indirect', 'Final', 'Target met'], rows: coRows, sheet: 'C3 CO attainment', only: 'workbook' });
          blocks.push({ kind: 'table', columns: ['Course', 'CO', ...outcomes.map((o) => o.code)], rows: mapRows, sheet: 'C3 Mapping', only: 'workbook' });
        }
        blocks.push({ kind: 'heading', level: 2, text: 'Program outcome attainment' });
        const poRows = outcomes.map((o) => {
          const values = perCourse.map(({ cos }) => poAttainment(cos.map((c) => ({ final: c.attainment.final, mapping: c.mapping })), o.id));
          const counted = values.filter((v) => v !== null).length;
          return [o.code, counted ? two(averageOf(values)) : MISSING, String(counted)];
        });
        if (poRows.length) blocks.push({ kind: 'table', columns: ['Outcome', 'Attainment (of 3)', 'Courses counted'], rows: poRows, sheet: 'C3 PO attainment' });
        break;
      }
      case 'students': {
        if (batches.length === 0) {
          gap(4, `No student batches are entered for ${program.name} in ${span.map((y) => labelOf.get(y.id)).join(', ')} (Data registers, Student batches).`);
          break;
        }
        blocks.push({
          kind: 'table',
          columns: ['Year', 'Batch', 'Intake', 'Admitted', 'Appeared (final year)', 'Passed (minimum time)', 'Placed', 'Higher studies', 'Median salary (₹ lakh)'],
          rows: batches.map((b) => {
            const d = b.data as Record<string, RegisterValue>;
            return [labelOf.get(b.academicYearId) ?? '', String(d.batch ?? ''), cell(num(d.intake)), cell(num(d.enrolled)), cell(num(d.appearedFinal)), cell(num(d.passedOnTime)), cell(num(d.placed)), cell(num(d.higherStudies)), cell(num(d.medianSalaryLakh))];
          }),
          sheet: 'C4 Students',
        });
        for (const y of span.filter((y) => !batches.some((b) => b.academicYearId === y.id))) gap(4, `No student batches entered for ${labelOf.get(y.id)}.`);
        break;
      }
      case 'faculty': {
        blocks.push({ kind: 'heading', level: 2, text: `Faculty of ${program.department.code}` });
        const facultyRows = span.map((y) => {
          const rows = faculty.filter((f) => f.academicYearId === y.id).map((f) => f.data as Record<string, RegisterValue>);
          if (rows.length === 0) return [labelOf.get(y.id) ?? '', MISSING, MISSING, MISSING, MISSING, MISSING];
          const fullTime = rows.filter((r) => r.employment === 'Full-time');
          return [
            labelOf.get(y.id) ?? '',
            String(fullTime.length),
            String(fullTime.filter((r) => r.qualification === 'Ph.D.').length),
            String(fullTime.filter((r) => r.qualification === 'PG with NET/SET/SLET').length),
            String(rows.length - fullTime.length),
            String(fullTime.filter((r) => typeof r.fdpsThisYear === 'number' && r.fdpsThisYear >= 1).length),
          ];
        });
        blocks.push({ kind: 'table', columns: ['Year', 'Full-time teachers', 'With Ph.D.', 'With NET/SET/SLET', 'Other teachers', 'With an FDP or training'], rows: facultyRows, sheet: 'C5 Faculty' });
        for (const y of span.filter((y) => !faculty.some((f) => f.academicYearId === y.id))) gap(5, `No faculty profiles entered for ${program.department.code} in ${labelOf.get(y.id)}.`);
        blocks.push({ kind: 'heading', level: 2, text: 'Research and development' });
        const kinds = ['Journal paper', 'Conference paper', 'Book', 'Book chapter', 'Patent filed', 'Patent published', 'Patent granted', 'Funded project', 'Consultancy'];
        blocks.push({
          kind: 'table',
          columns: ['Year', 'UGC CARE journal papers', ...kinds, 'Grants and consultancy (₹ lakh)'],
          rows: span.map((y) => {
            const rows = research.filter((r) => r.academicYearId === y.id).map((r) => r.data as Record<string, RegisterValue>);
            const amount = rows.filter((r) => r.kind === 'Funded project' || r.kind === 'Consultancy').reduce((s, r) => s + (num(r.amountLakh) ?? 0), 0);
            return [
              labelOf.get(y.id) ?? '',
              String(rows.filter((r) => r.kind === 'Journal paper' && r.ugcCare === true).length),
              ...kinds.map((k) => String(rows.filter((r) => r.kind === k).length)),
              amount ? amount.toLocaleString('en-IN') : '0',
            ];
          }),
          sheet: 'C5 Research',
        });
        if (research.length === 0) gap(5, `No research entries for ${program.department.code} in these years (Data registers, Research).`);
        break;
      }
      case 'facilities': {
        if (facilities.length === 0) {
          gap(6, `No labs, equipment or spending entered for ${program.department.code} (Data registers, Infrastructure and finance).`);
          break;
        }
        blocks.push({
          kind: 'table',
          columns: ['Year', 'Item', 'Category', 'Quantity or size', 'Amount (₹ lakh)'],
          rows: facilities.map((f) => {
            const d = f.data as Record<string, RegisterValue>;
            return [labelOf.get(f.academicYearId) ?? '', String(d.item ?? ''), String(d.category ?? ''), String(d.quantity ?? '–'), d.amountLakh === null || d.amountLakh === undefined ? '–' : String(d.amountLakh)];
          }),
          sheet: 'C6 Facilities',
        });
        break;
      }
      default:
        blocks.push({ kind: 'text', text: 'Not compiled from YuCampus yet. Write this criterion in the SAR yourself.', tone: 'muted' });
        gaps.push({ criterion: criterion.number, text: `Criterion ${criterion.number} (${criterion.name}) is not compiled from YuCampus yet.` });
    }
  }

  const summaryRows = layout.criteria.map((c) => {
    const count = gaps.filter((g) => g.criterion === c.number).length;
    return [String(c.number), c.name, c.compiles ? 'Yes' : 'No, write it by hand', c.compiles ? (count ? `${count} missing` : 'Complete') : '–'];
  });
  blocks.splice(
    summaryAt,
    0,
    { kind: 'heading', level: 2, text: 'Summary' },
    { kind: 'table', columns: ['Criterion', 'Name', 'Compiled from YuCampus', 'Status'], rows: summaryRows, sheet: 'Criteria' },
  );

  return {
    title: layout.name,
    label,
    collegeName: college.name,
    programName: program.name,
    generatedAt: new Date(),
    generatedBy: creator?.name ?? 'Someone',
    verified: layout.source.verified,
    blocks,
    gaps,
  };
}
