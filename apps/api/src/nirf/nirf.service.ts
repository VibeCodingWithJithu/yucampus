import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { type NirfItemView, type NirfView, can } from '@yucampus/types';
import { type MetricDataSource, type NirfTemplate, nirfTemplateSchema } from '@yucampus/validation';
import ExcelJS from 'exceljs';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';
import { metricData } from '../registers/metric-data.js';

const NIRF: NirfTemplate = nirfTemplateSchema.parse(
  JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../rules/nirf/parameters.json'), 'utf8')),
);

const percentOf = (values: (number | null)[]) => (values.length ? Math.round((values.filter((v) => v !== null).length / values.length) * 100) : null);

/** NIRF data readiness (docs/PRODUCT.md "NIRF"). Inputs from the registers, never a score. */
@Injectable()
export class NirfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private async grants(actor: AuthUser) {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    if (!can(grants, 'dashboards.view', ['college']) && !can(grants, 'reports.generate', ['nirf'])) {
      throw apiError(403, 'forbidden', 'NIRF data is for the NIRF coordinator, IQAC and the principal.');
    }
    return grants;
  }

  async view(actor: AuthUser, categoryCode?: string): Promise<NirfView> {
    const grants = await this.grants(actor);
    return this.prisma.forTenant(actor.collegeId, (db) => this.build(db, actor.collegeId, categoryCode, can(grants, 'tasks.assign')));
  }

  private async build(db: TenantClient, collegeId: string, categoryCode: string | undefined, canAssign: boolean): Promise<NirfView> {
    const chosen = await db.collegeFramework.findMany({
      where: { collegeId, active: true, framework: { body: 'NIRF' } },
      include: { framework: { select: { code: true, name: true } } },
    });
    const categories = chosen
      .map((c) => ({ code: c.framework.code, name: c.framework.name }))
      .filter((c, i, all) => all.findIndex((x) => x.code === c.code) === i)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (categories.length === 0) {
      throw apiError(404, 'no_framework', 'Your college has not chosen a NIRF category yet. Choose one in Institution setup.');
    }
    const category = categories.find((c) => c.code === categoryCode) ?? categories[0]!;
    const weights = NIRF.categories[category.code]?.weights ?? null;

    // The three latest academic years that have started, oldest first.
    const years = (await db.academicYear.findMany({ where: { collegeId, status: { not: 'next' } }, orderBy: { startDate: 'asc' } })).slice(-3);
    const dataYears = years.map((y) => ({ id: y.id, label: y.label }));

    const parameters = [];
    for (const parameter of NIRF.parameters) {
      const subs = [];
      for (const sub of parameter.subs) {
        let items: NirfItemView[] = [];
        if (sub.items.length) {
          const data = await metricData(db, collegeId, { measures: sub.items, ratios: [] } as MetricDataSource, dataYears);
          items = sub.items.map((item, i) => ({
            key: item.key,
            label: item.label,
            register: item.register,
            ...(item.unit ? { unit: item.unit } : {}),
            values: data.years.map((y) => y.values[i] ?? null),
          }));
        }
        subs.push({ code: sub.code, name: sub.name, owner: sub.owner, percent: percentOf(items.flatMap((i) => i.values)), items });
      }
      parameters.push({
        key: parameter.key,
        name: parameter.name,
        weight: weights?.[parameter.key] ?? null,
        ...(parameter.note ? { note: parameter.note } : {}),
        percent: percentOf(subs.flatMap((s) => s.items.flatMap((i) => i.values))),
        subs,
      });
    }
    const allItems = parameters.flatMap((p) => p.subs.flatMap((s) => s.items));
    return {
      categories,
      category,
      years: years.map((y, i) => ({ label: y.label.replace('-', '–'), percent: percentOf(allItems.map((item) => item.values[i] ?? null)) ?? 0 })),
      parameters,
      source: NIRF.source,
      can: { assign: canAssign },
    };
  }

  /** The data sheets: one sheet per parameter, every item for the three years, gaps marked "Not entered". */
  async sheet(actor: AuthUser, categoryCode?: string): Promise<{ name: string; body: Buffer }> {
    const view = await this.view(actor, categoryCode);
    const college = await this.prisma.forTenant(actor.collegeId, (db) => db.college.findUniqueOrThrow({ where: { id: actor.collegeId }, select: { name: true } }));
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'YuCampus';
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [{ width: 26 }, { width: 90 }];
    for (const [label, value] of [
      ['College', college.name],
      ['Category', view.category.name],
      ['Years', view.years.map((y) => `${y.label} (${y.percent}% entered)`).join(', ')],
      ['Note', 'Inputs from YuCampus registers, not a score. NIRF takes publications and perception from its own sources.'],
      ...(view.source.verified ? [] : [['Check first', view.source.title]]),
    ] as [string, string][]) {
      summary.addRow([label, value]).getCell(1).font = { bold: true };
    }
    for (const parameter of view.parameters) {
      if (parameter.subs.every((s) => s.items.length === 0)) continue;
      const sheet = workbook.addWorksheet(parameter.key, { views: [{ state: 'frozen', ySplit: 1 }] });
      sheet.columns = [
        { header: 'Sub-parameter', width: 12 },
        { header: 'Name', width: 40 },
        { header: 'Data item', width: 44 },
        { header: 'Unit', width: 10 },
        ...view.years.map((y) => ({ header: y.label, width: 14 })),
      ];
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      for (const sub of parameter.subs) {
        for (const item of sub.items) {
          const row = sheet.addRow([sub.code, sub.name, item.label, item.unit ?? '', ...item.values.map((v) => (v === null ? 'Not entered' : v))]);
          item.values.forEach((v, i) => {
            if (v === null) {
              row.getCell(5 + i).font = { bold: true, color: { argb: 'FF8F1D17' } };
              row.getCell(5 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE4E2' } };
            }
          });
        }
      }
    }
    return { name: `NIRF ${view.category.name.replace(/^NIRF · /, '')} data sheets.xlsx`, body: Buffer.from(await workbook.xlsx.writeBuffer()) };
  }
}
