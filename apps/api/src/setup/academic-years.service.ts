import { Injectable } from '@nestjs/common';
import type { AcademicYearView, KeyDateView, Term } from '@yucampus/types';
import type { AcademicYearDatesInput, KeyDateInput } from '@yucampus/validation';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { fromIsoDate, notFound, toIsoDate } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';

const locked = () => apiError(409, 'year_locked', 'This academic year is locked. Its dates can no longer change.');

type KeyDateRow = { id: string; title: string; date: Date; reminderRule: Prisma.JsonValue };

const remindDays = (rule: Prisma.JsonValue): number => {
  const days = rule && typeof rule === 'object' && !Array.isArray(rule) ? rule.daysBefore : undefined;
  return Array.isArray(days) && typeof days[0] === 'number' ? days[0] : 7;
};

const toKeyDate = (row: KeyDateRow): KeyDateView => ({
  id: row.id,
  title: row.title,
  date: toIsoDate(row.date),
  remindDaysBefore: remindDays(row.reminderRule),
});

/** Moves a YYYY-MM-DD date on by whole years (29 Feb becomes 28 Feb). */
function addYears(date: string, years: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year + years, month - 1, day));
  if (target.getUTCMonth() !== month - 1) target.setUTCDate(0);
  return toIsoDate(target);
}

/** "2026-27" for a year starting in 2026; a year inside one calendar year is just "2026". */
const labelFor = (start: string, end: string) =>
  start.slice(0, 4) === end.slice(0, 4) ? start.slice(0, 4) : `${start.slice(0, 4)}-${end.slice(2, 4)}`;

@Injectable()
export class AcademicYearsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first. */
  list(actor: AuthUser): Promise<AcademicYearView[]> {
    return this.prisma.forTenant(actor.collegeId, (db) => this.load(db, actor.collegeId));
  }

  async updateDates(actor: AuthUser, id: string, input: AcademicYearDatesInput): Promise<AcademicYearView> {
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const year = await this.editable(db, actor, id);
      await db.academicYear.update({
        where: { id },
        data: { startDate: fromIsoDate(input.startDate), endDate: fromIsoDate(input.endDate), terms: input.terms },
      });
      await audit(db, actor, 'academic_year', id, 'update_dates', {
        before: { startDate: toIsoDate(year.startDate), endDate: toIsoDate(year.endDate), terms: year.terms },
        after: input,
      });
      return (await this.load(db, actor.collegeId, id))[0]!;
    });
  }

  async addKeyDate(actor: AuthUser, academicYearId: string, input: KeyDateInput & { remindDaysBefore: number }): Promise<KeyDateView> {
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      await this.editable(db, actor, academicYearId);
      const row = await db.keyDate.create({
        data: {
          collegeId: actor.collegeId,
          academicYearId,
          title: input.title,
          date: fromIsoDate(input.date),
          reminderRule: { daysBefore: [input.remindDaysBefore], channels: ['in_app', 'email'] },
        },
      });
      await audit(db, actor, 'key_date', row.id, 'create', { after: { academicYearId, ...input } });
      return toKeyDate(row);
    });
  }

  async updateKeyDate(actor: AuthUser, id: string, input: KeyDateInput & { remindDaysBefore: number }): Promise<KeyDateView> {
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const before = await db.keyDate.findFirst({ where: { id, collegeId: actor.collegeId } });
      if (!before) throw notFound('date');
      await this.editable(db, actor, before.academicYearId);
      const row = await db.keyDate.update({
        where: { id },
        data: {
          title: input.title,
          date: fromIsoDate(input.date),
          reminderRule: { daysBefore: [input.remindDaysBefore], channels: ['in_app', 'email'] },
        },
      });
      await audit(db, actor, 'key_date', id, 'update', { before: toKeyDate(before), after: input });
      return toKeyDate(row);
    });
  }

  async removeKeyDate(actor: AuthUser, id: string): Promise<void> {
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const row = await db.keyDate.findFirst({ where: { id, collegeId: actor.collegeId } });
      if (!row) throw notFound('date');
      await this.editable(db, actor, row.academicYearId);
      await db.keyDate.delete({ where: { id } });
      await audit(db, actor, 'key_date', id, 'delete', { before: toKeyDate(row) });
    });
  }

  /**
   * Locks the current year, makes the next one current, and prepares the year after it.
   * Departments, programs and people are not tied to a year, so they simply carry on.
   */
  async startNextYear(actor: AuthUser): Promise<AcademicYearView[]> {
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const collegeId = actor.collegeId;
      const [current, next] = await Promise.all([
        db.academicYear.findFirst({ where: { collegeId, status: 'current' } }),
        db.academicYear.findFirst({ where: { collegeId, status: 'next' } }),
      ]);
      if (!current || !next) {
        throw apiError(409, 'no_next_year', 'There is no next academic year to start. Contact YuCampus support.');
      }

      // Order matters: one current and one next per college is enforced by the database.
      await db.academicYear.update({ where: { id: current.id }, data: { status: 'locked' } });
      await db.academicYear.update({ where: { id: next.id }, data: { status: 'current' } });

      const start = addYears(toIsoDate(next.startDate), 1);
      const end = addYears(toIsoDate(next.endDate), 1);
      const terms = (next.terms as unknown as Term[]).map((term) => ({
        name: term.name,
        start: addYears(term.start, 1),
        end: addYears(term.end, 1),
      }));
      const created = await db.academicYear.create({
        data: {
          collegeId,
          label: labelFor(start, end),
          startDate: fromIsoDate(start),
          endDate: fromIsoDate(end),
          status: 'next',
          terms,
        },
      });

      await audit(db, actor, 'academic_year', next.id, 'start_year', {
        before: { current: current.label, next: next.label },
        after: { current: next.label, locked: current.label, next: created.label },
      });
      return this.load(db, collegeId);
    });
  }

  /** The year, if it exists in this college and is not locked. */
  private async editable(db: TenantClient, actor: AuthUser, id: string) {
    const year = await db.academicYear.findFirst({ where: { id, collegeId: actor.collegeId } });
    if (!year) throw notFound('academic year');
    if (year.status === 'locked') throw locked();
    return year;
  }

  private async load(db: TenantClient, collegeId: string, id?: string): Promise<AcademicYearView[]> {
    const years = await db.academicYear.findMany({
      where: { collegeId, ...(id ? { id } : {}) },
      orderBy: { startDate: 'desc' },
      include: { keyDates: { orderBy: { date: 'asc' } } },
    });
    return years.map((year) => ({
      id: year.id,
      label: year.label,
      status: year.status,
      startDate: toIsoDate(year.startDate),
      endDate: toIsoDate(year.endDate),
      terms: year.terms as unknown as Term[],
      keyDates: year.keyDates.map(toKeyDate),
    }));
  }
}
