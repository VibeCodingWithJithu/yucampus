import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { type AisheBlockView, type AisheFigureView, type AisheFinding, type AisheView, can } from '@yucampus/types';
import {
  type AisheChecks,
  type AisheProfileField,
  type AisheSurvey,
  type MetricDataSource,
  type SubmittedFigureInput,
  aisheChecksSchema,
  aisheSurveySchema,
  SUBMISSION_PORTALS,
  registerDefinitionSchema,
  submittedFigureSchema,
} from '@yucampus/validation';
import ExcelJS from 'exceljs';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';
import { type MetricDataYear, metricData } from '../registers/metric-data.js';

const rules = (file: string) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../rules/aishe', file), 'utf8'));
const SURVEY: AisheSurvey = aisheSurveySchema.parse(rules('survey.json'));
const CHECKS: AisheChecks = aisheChecksSchema.parse(rules('checks.json'));

const PROFILE_LABELS: Record<AisheProfileField, string> = {
  aisheCode: 'AISHE code',
  name: 'Name of the college',
  type: 'Type',
  state: 'State',
  city: 'City or town',
  affiliatingUniversity: 'Affiliating university',
  establishedYear: 'Year of establishment',
};
const TYPE_LABELS: Record<string, string> = { affiliated: 'Affiliated college', autonomous: 'Autonomous college', university: 'University' };

const yearLabel = (label: string) => label.replace('-', '–');
const number = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const withUnit = (value: number, unit?: string) => (unit ? `${number(value)} ${unit}` : number(value));
const percentOf = (entered: number, total: number) => (total ? Math.round((entered / total) * 100) : 0);
/** "Of whom women" -> "Women": register labels read naturally inside a sentence. */
const shortLabel = (label: string) => {
  const short = label.replace(/^Of whom (with |from )?/i, '');
  return short.charAt(0).toUpperCase() + short.slice(1);
};
const source = (measures: MetricDataSource['measures']): MetricDataSource => ({ measures, ratios: [] }) as MetricDataSource;

interface Year {
  id: string;
  label: string;
  status: string;
}

/** AISHE data forms and the consistency checker (docs/PRODUCT.md "AISHE and consistency checks"). */
@Injectable()
export class AisheService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private async grants(actor: AuthUser) {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    if (!can(grants, 'dashboards.view', ['college'])) {
      throw apiError(403, 'forbidden', 'AISHE data is for IQAC, the principal and the college admin.');
    }
    return grants;
  }

  async view(actor: AuthUser, yearId?: string): Promise<AisheView> {
    const grants = await this.grants(actor);
    return this.prisma.forTenant(actor.collegeId, (db) =>
      this.build(db, actor.collegeId, yearId, { assign: can(grants, 'tasks.assign'), recordSubmitted: can(grants, 'registers.edit', ['college']) }),
    );
  }

  private async build(db: TenantClient, collegeId: string, yearId: string | undefined, permissions: AisheView['can']): Promise<AisheView> {
    // Years that have started, newest first. The survey year defaults to the latest finished (locked) year.
    const years: Year[] = (await db.academicYear.findMany({ where: { collegeId, status: { not: 'next' } }, orderBy: { startDate: 'desc' } })).map((y) => ({
      id: y.id,
      label: yearLabel(y.label),
      status: y.status,
    }));
    if (years.length === 0) throw apiError(404, 'no_year', 'Add an academic year in Institution setup first.');
    const year = years.find((y) => y.id === yearId) ?? years.find((y) => y.status === 'locked') ?? years[0]!;
    const previous = years[years.indexOf(year) + 1] ?? null;
    const dataYears: MetricDataYear[] = previous ? [previous, year] : [year];
    // Values are always [year before, survey year]; the year before is null when there is none.
    const pair = (values: (number | null)[]) => (previous ? values : [null, ...values]);

    const college = await db.college.findUniqueOrThrow({ where: { id: collegeId } });
    const settings = (college.settings && typeof college.settings === 'object' && !Array.isArray(college.settings) ? college.settings : {}) as Record<string, unknown>;
    const profileValue = (field: AisheProfileField): string | null => {
      const raw = field === 'name' ? college.name : field === 'type' ? TYPE_LABELS[college.type] : field === 'state' ? college.state : settings[field];
      return raw === null || raw === undefined || String(raw).trim() === '' ? null : String(raw);
    };
    const programs = await db.program.findMany({ where: { collegeId }, orderBy: [{ level: 'asc' }, { name: 'asc' }], select: { id: true, name: true, level: true } });

    const blocks: AisheBlockView[] = [];
    for (const block of SURVEY.blocks) {
      const data = block.items.length ? await metricData(db, collegeId, source(block.items), dataYears) : null;
      const items = block.items.map((item, i) => ({
        key: item.key,
        label: item.label,
        register: item.register,
        ...(item.unit ? { unit: item.unit } : {}),
        values: pair(data!.years.map((y) => y.values[i] ?? null)),
      }));
      const profile = block.profile.map((field) => ({ key: field, label: PROFILE_LABELS[field], value: profileValue(field) }));
      let perProgram: AisheBlockView['perProgram'] = null;
      if (block.perProgram) {
        const split = block.items.filter((item) => !item.collegeOnly);
        const rows = [];
        for (const program of programs) {
          const where = (item: (typeof split)[number]) => ({ ...item.where, program: [program.id] });
          // A programme without any record in a register is not entered there, never 0.
          const registersUsed = [...new Set(split.map((item) => item.register))];
          const measures = [
            ...split.map((item) => ({ ...item, where: where(item) })),
            ...registersUsed.map((register) => ({ key: 'records', label: 'Records', register, op: 'count' as const, where: { program: [program.id] }, atLeast: {} })),
          ];
          const all = (await metricData(db, collegeId, source(measures), [year])).years[0]!.values;
          const records = (register: string) => all[split.length + registersUsed.indexOf(register)] ?? 0;
          rows.push({ ...program, values: split.map((item, i) => (records(item.register) ? (all[i] ?? null) : null)) });
        }
        perProgram = { itemKeys: split.map((item) => item.key), rows };
      }
      const now = [...items.map((item) => item.values[1]), ...profile.map((p) => p.value)];
      blocks.push({
        key: block.key,
        name: block.name,
        owner: block.owner,
        ...(block.note ? { note: block.note } : {}),
        percent: percentOf(now.filter((v) => v !== null).length, now.length),
        profile,
        items,
        perProgram,
      });
    }
    const all = blocks.flatMap((b) => [...b.items.map((i) => i.values[1]), ...b.profile.map((p) => p.value)]);

    const figures = await this.figures(db, collegeId, year);
    const checks = await this.checks(db, collegeId, college.type, profileValue, year, previous, figures);
    return {
      years: years.map(({ id, label, status }) => ({ id, label, status })),
      year: { id: year.id, label: year.label },
      previousYear: previous ? { id: previous.id, label: previous.label } : null,
      percent: percentOf(all.filter((v) => v !== null).length, all.length),
      blocks,
      checks,
      figures,
      source: SURVEY.source,
      checksSource: CHECKS.source,
      can: permissions,
    };
  }

  /** The common figures: the registers' value for the survey year and what was submitted to each portal. */
  private async figures(db: TenantClient, collegeId: string, year: Year): Promise<AisheFigureView[]> {
    const data = await metricData(db, collegeId, source(CHECKS.figures), [year]);
    const order: string[] = [...SUBMISSION_PORTALS];
    const submitted = (await db.submittedFigure.findMany({ where: { collegeId, academicYearId: year.id } })).sort((a, b) => order.indexOf(a.portal) - order.indexOf(b.portal));
    return CHECKS.figures.map((figure, i) => ({
      key: figure.key,
      label: figure.label,
      ...(figure.unit ? { unit: figure.unit } : {}),
      portals: figure.portals,
      registers: data.years[0]!.values[i] ?? null,
      submitted: submitted
        .filter((s) => s.figureKey === figure.key && (figure.portals as string[]).includes(s.portal))
        .map((s) => ({ portal: s.portal as 'AISHE' | 'NIRF' | 'NAAC', value: Number(s.value), note: s.note, updatedAt: s.updatedAt.toISOString() })),
    }));
  }

  private async checks(
    db: TenantClient,
    collegeId: string,
    collegeType: string,
    profileValue: (field: AisheProfileField) => string | null,
    year: Year,
    previous: Year | null,
    figures: AisheFigureView[],
  ): Promise<AisheView['checks']> {
    const findings: AisheFinding[] = [];
    let total = 0;
    let failed = 0;
    const definitions = await db.registerDefinition.findMany({ orderBy: { createdAt: 'desc' } });
    const definitionOf = (code: string) => {
      const row = definitions.find((d) => d.code === code && d.status === 'active') ?? definitions.find((d) => d.code === code);
      return row ? { ids: definitions.filter((d) => d.code === code).map((d) => d.id), name: row.name, definition: registerDefinitionSchema.parse(row.definition) } : null;
    };
    const fixIn = (code: string) => ({ label: definitionOf(code)?.name ?? code, href: `/registers?register=${code}` });

    for (const check of CHECKS.checks) {
      const before = findings.length;
      if (check.kind === 'record') {
        const register = definitionOf(check.register);
        if (!register) continue;
        total++;
        const fields = register.definition.fields;
        const labelOf = (keys: string[]) => keys.map((key) => shortLabel(fields.find((f) => f.key === key)?.label ?? key)).join(' + ');
        const records = await db.registerRecord.findMany({ where: { collegeId, academicYearId: year.id, definitionId: { in: register.ids } }, orderBy: { createdAt: 'asc' } });
        const programNames = new Map((await db.program.findMany({ where: { collegeId }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
        for (const record of records) {
          const data = (record.data ?? {}) as Record<string, unknown>;
          const add = (keys: string[]) => {
            const numbers = keys.map((key) => data[key]).filter((v): v is number => typeof v === 'number');
            return numbers.length ? numbers.reduce((a, b) => a + b, 0) : null;
          };
          const left = add(check.left);
          const right = add(check.right);
          if (left === null || right === null || left <= right) continue;
          const program = fields.find((f) => f.type === 'program');
          const name = [data[register.definition.titleField], program ? programNames.get(String(data[program.key])) : null].filter(Boolean).join(' · ');
          findings.push({
            code: check.code,
            level: check.level,
            title: check.title,
            detail: `${name || register.name}: ${labelOf(check.left)} ${number(left)}, ${labelOf(check.right)} ${number(right)}.`,
            fix: fixIn(check.register),
          });
        }
      } else if (check.kind === 'total') {
        const [left, right] = (await metricData(db, collegeId, source([check.left, check.right]), [year])).years[0]!.values;
        total++;
        if (left !== null && left !== undefined && right !== null && right !== undefined && left > right) {
          findings.push({
            code: check.code,
            level: check.level,
            title: check.title,
            detail: `${check.left.label} ${withUnit(left, check.left.unit)}, ${check.right.label} ${withUnit(right, check.right.unit)}.`,
            fix: fixIn(check.left.register === 'COLLEGE_FIGURES' ? check.right.register : check.left.register),
          });
        }
      } else if (check.kind === 'change') {
        if (!previous) continue;
        total++;
        const [before, now] = (await metricData(db, collegeId, source([check.measure]), [previous, year])).years.map((y) => y.values[0] ?? null);
        if (before !== null && before !== undefined && now !== null && now !== undefined && before > 0) {
          const change = Math.round(((now - before) / before) * 100);
          if (Math.abs(change) > check.maxPercent) {
            findings.push({
              code: check.code,
              level: check.level,
              title: check.title,
              detail: `${check.measure.label}: ${withUnit(before, check.measure.unit)} in ${previous.label}, ${withUnit(now, check.measure.unit)} in ${year.label} (${change > 0 ? 'up' : 'down'} ${Math.abs(change)}%). Confirm it is right.`,
              fix: fixIn(check.measure.register),
            });
          }
        }
      } else {
        if (check.only && !check.only.includes(collegeType as 'affiliated')) continue;
        total++;
        if (profileValue(check.field) === null) {
          findings.push({ code: check.code, level: check.level, title: check.title, detail: `${PROFILE_LABELS[check.field]} is empty in the institution profile.`, fix: { label: 'Institution setup', href: '/setup' } });
        }
      }
      if (findings.length > before) failed++;
    }

    // What was submitted to the portals, against the registers and against each other.
    for (const figure of figures) {
      if (figure.submitted.length === 0) continue;
      const amount = (value: number) => withUnit(value, figure.unit);
      if (figure.registers !== null) {
        total++;
        const differing = figure.submitted.filter((s) => Math.abs(s.value - figure.registers!) >= 0.005);
        for (const s of differing) {
          findings.push({
            code: `SF-${figure.key}`,
            level: 'check',
            title: `${figure.label}: submitted to ${s.portal} differs from the registers`,
            detail: `Submitted to ${s.portal}: ${amount(s.value)}. Registers for ${year.label}: ${amount(figure.registers)}.`,
            fix: { label: 'Submitted figures', href: '#submitted' },
          });
        }
        if (differing.length) failed++;
      }
      if (figure.submitted.length > 1) {
        total++;
        if (new Set(figure.submitted.map((s) => s.value.toFixed(2))).size > 1) {
          failed++;
          findings.push({
            code: `SP-${figure.key}`,
            level: 'error',
            title: `${figure.label} was submitted differently to ${figure.submitted.map((s) => s.portal).join(' and ')}`,
            detail: `${figure.submitted.map((s) => `${s.portal}: ${amount(s.value)}`).join(', ')}. Where the portals define it the same way, these should match.`,
            fix: { label: 'Submitted figures', href: '#submitted' },
          });
        }
      }
    }
    findings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
    return {
      findings,
      errors: findings.filter((f) => f.level === 'error').length,
      warnings: findings.filter((f) => f.level === 'check').length,
      passed: total - failed,
      total,
    };
  }

  /** Records (or, with a null value, removes) what the college submitted to a portal for one figure and year. */
  async setFigure(actor: AuthUser, input: SubmittedFigureInput): Promise<AisheView> {
    const grants = await this.grants(actor);
    if (!can(grants, 'registers.edit', ['college'])) {
      throw apiError(403, 'forbidden', 'Submitted figures are recorded by those who maintain the registers for the whole college.');
    }
    const parsed = submittedFigureSchema.safeParse(input);
    if (!parsed.success) throw apiError(400, 'invalid_input', parsed.error.issues[0]?.message ?? 'Check the values.');
    const { academicYearId, portal, key, value, note } = parsed.data;
    const figure = CHECKS.figures.find((f) => f.key === key);
    if (!figure) throw apiError(400, 'invalid_input', 'That figure is not on the list.');
    if (!(figure.portals as string[]).includes(portal)) throw apiError(400, 'invalid_input', `${portal} does not ask for ${figure.label.toLowerCase()}.`);
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      if (!(await db.academicYear.findFirst({ where: { id: academicYearId, collegeId: actor.collegeId } }))) {
        throw apiError(404, 'not_found', 'We could not find that academic year.');
      }
      const where = { collegeId_academicYearId_portal_figureKey: { collegeId: actor.collegeId, academicYearId, portal, figureKey: key } };
      const before = await db.submittedFigure.findUnique({ where });
      if (value === null) {
        if (!before) return;
        await db.submittedFigure.delete({ where });
        await audit(db, actor, 'submitted_figure', before.id, 'delete', { before: { portal, key, value: Number(before.value), note: before.note } });
        return;
      }
      const saved = await db.submittedFigure.upsert({
        where,
        create: { collegeId: actor.collegeId, academicYearId, portal, figureKey: key, value, note: note ?? null, updatedById: actor.id },
        update: { value, note: note ?? null, updatedById: actor.id },
      });
      await audit(db, actor, 'submitted_figure', saved.id, before ? 'update' : 'create', {
        before: before ? { portal, key, value: Number(before.value), note: before.note } : undefined,
        after: { portal, key, value, note: note ?? null },
      });
    });
    return this.view(actor, academicYearId);
  }

  /** The data forms as an Excel workbook: one sheet per block, the checker's findings and the submitted figures. */
  async sheet(actor: AuthUser, yearId?: string): Promise<{ name: string; body: Buffer }> {
    const view = await this.view(actor, yearId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'YuCampus';
    const header = (sheet: ExcelJS.Worksheet) => {
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
    };
    const missing = (cell: ExcelJS.Cell) => {
      cell.font = { bold: true, color: { argb: 'FF8F1D17' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE4E2' } };
    };
    const cellValue = (v: number | string | null) => (v === null ? 'Not entered' : v);

    const summary = workbook.addWorksheet('Summary');
    summary.columns = [{ width: 26 }, { width: 90 }];
    const profile = view.blocks.flatMap((b) => b.profile);
    for (const [label, value] of [
      ['College', profile.find((p) => p.key === 'name')?.value ?? ''],
      ['AISHE code', profile.find((p) => p.key === 'aisheCode')?.value ?? 'Not entered'],
      ['Survey year', view.year.label],
      ['Data entered', `${view.percent}%`],
      ['Checks', `${view.checks.errors} errors, ${view.checks.warnings} to check, ${view.checks.passed} of ${view.checks.total} checks passed`],
      ['Note', 'Figures from YuCampus registers, to be typed into the AISHE portal. Nothing has been sent to AISHE.'],
      ...(view.source.verified ? [] : [['Check first', view.source.title]]),
      ...(view.checksSource.verified ? [] : [['Checks', view.checksSource.title]]),
    ] as [string, string][]) {
      summary.addRow([label, value]).getCell(1).font = { bold: true };
    }

    for (const block of view.blocks) {
      const sheet = workbook.addWorksheet(block.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), { views: [{ state: 'frozen', ySplit: 1 }] });
      if (block.profile.length) {
        sheet.columns = [
          { header: 'Item', width: 34 },
          { header: 'Value', width: 50 },
        ];
        header(sheet);
        for (const item of block.profile) {
          const row = sheet.addRow([item.label, cellValue(item.value)]);
          if (item.value === null) missing(row.getCell(2));
        }
        continue;
      }
      const labels = [view.previousYear?.label ?? 'Year before', view.year.label];
      sheet.columns = [
        { header: 'Data item', width: 46 },
        { header: 'Unit', width: 10 },
        ...labels.map((label) => ({ header: label, width: 14 })),
      ];
      header(sheet);
      for (const item of block.items) {
        const row = sheet.addRow([item.label, item.unit ?? '', ...item.values.map(cellValue)]);
        item.values.forEach((v, i) => v === null && missing(row.getCell(3 + i)));
      }
      if (block.note) sheet.addRow([]).getCell(1).value = block.note;
      if (block.perProgram) {
        sheet.addRow([]);
        const keys = block.perProgram.itemKeys;
        const titles = sheet.addRow(['Programme', 'Level', ...keys.map((key) => block.items.find((i) => i.key === key)?.label ?? key)]);
        titles.font = { bold: true };
        for (const program of block.perProgram.rows) {
          const row = sheet.addRow([program.name, program.level, ...program.values.map(cellValue)]);
          program.values.forEach((v, i) => v === null && missing(row.getCell(3 + i)));
        }
      }
    }

    const checks = workbook.addWorksheet('Checks', { views: [{ state: 'frozen', ySplit: 1 }] });
    checks.columns = [
      { header: 'Level', width: 10 },
      { header: 'Code', width: 18 },
      { header: 'Finding', width: 60 },
      { header: 'Details', width: 80 },
      { header: 'Fix in', width: 24 },
    ];
    header(checks);
    for (const f of view.checks.findings) checks.addRow([f.level === 'error' ? 'Error' : 'Check', f.code, f.title, f.detail, f.fix.label]);
    if (view.checks.findings.length === 0) checks.addRow(['', '', 'No findings', '', '']);

    const submitted = workbook.addWorksheet('Submitted figures', { views: [{ state: 'frozen', ySplit: 1 }] });
    submitted.columns = [
      { header: 'Figure', width: 40 },
      { header: 'Unit', width: 10 },
      { header: 'Registers', width: 14 },
      { header: 'AISHE', width: 14 },
      { header: 'NIRF', width: 14 },
      { header: 'NAAC', width: 14 },
    ];
    header(submitted);
    for (const figure of view.figures) {
      const at = (portal: string) => (figure.portals.includes(portal as 'AISHE') ? (figure.submitted.find((s) => s.portal === portal)?.value ?? '') : '–');
      submitted.addRow([figure.label, figure.unit ?? '', cellValue(figure.registers), at('AISHE'), at('NIRF'), at('NAAC')]);
    }
    return { name: `AISHE ${view.year.label} data forms.xlsx`, body: Buffer.from(await workbook.xlsx.writeBuffer()) };
  }
}
