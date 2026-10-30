import { Injectable } from '@nestjs/common';
import { AUDIT_ENTITY_LABELS, AUDIT_EXPORT_LIMIT, type AuditChange, type AuditEntryView, type AuditPage, auditActionLabel, can } from '@yucampus/types';
import type { AuditQuery } from '@yucampus/validation';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';

/** Fields whose values are never shown, even if an older entry holds one. */
const HIDDEN = /password|hash|token|secret|otp/i;
const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function text(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const json = JSON.stringify(value);
  return json.length > 300 ? `${json.slice(0, 297)}…` : json;
}

/** The fields that differ between before and after, one level deep. */
export function changesOf(before: unknown, after: unknown): AuditChange[] {
  const b = isObject(before) ? before : before === null || before === undefined ? {} : { value: before };
  const a = isObject(after) ? after : after === null || after === undefined ? {} : { value: after };
  const changes: AuditChange[] = [];
  for (const field of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
    if (HIDDEN.test(field)) {
      if (JSON.stringify(b[field]) !== JSON.stringify(a[field])) {
        changes.push({ field, before: b[field] === undefined ? null : 'hidden', after: a[field] === undefined ? null : 'hidden' });
      }
      continue;
    }
    const was = text(b[field]);
    const now = text(a[field]);
    if (was !== now) changes.push({ field, before: was, after: now });
  }
  return changes;
}

/** "2026-10-18 14:05" in India time. */
const indiaTime = (at: Date) => new Date(at.getTime() + IST).toISOString().slice(0, 16).replace('T', ' ');

function csvCell(value: string): string {
  // A leading = + - @ would make a spreadsheet run it as a formula.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

type AuditRow = Prisma.AuditLogGetPayload<object>;

/** The college's audit log (docs/PRODUCT.md "Super-admin panel and audit log"). Read only: the log is append-only. */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private async allow(actor: AuthUser) {
    const grants = await this.permissions.grantsFor(actor.collegeId, actor.roles);
    if (!can(grants, 'permissions.manage') && !can(grants, 'users_setup.manage', ['college'])) {
      throw apiError(403, 'forbidden', 'The audit log is for the college admin and the principal.');
    }
  }

  private where(collegeId: string, query: AuditQuery): Prisma.AuditLogWhereInput {
    const at: Prisma.DateTimeFilter = {};
    if (query.from) at.gte = new Date(new Date(`${query.from}T00:00:00Z`).getTime() - IST);
    if (query.to) at.lt = new Date(new Date(`${query.to}T00:00:00Z`).getTime() - IST + DAY);
    return {
      collegeId,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.from || query.to ? { at } : {}),
    };
  }

  private async views(db: TenantClient, collegeId: string, rows: AuditRow[]): Promise<AuditEntryView[]> {
    const ids = [...new Set(rows.map((r) => r.userId).filter((id): id is string => Boolean(id)))];
    const names = new Map((await db.user.findMany({ where: { collegeId, id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return rows.map((row) => {
      const support = !row.userId && (row.action.startsWith('platform_') || (isObject(row.after) && row.after.by === 'YuCampus support'));
      const changes = changesOf(row.before, row.after).filter((c) => !(support && c.field === 'by'));
      return {
        id: row.id,
        at: row.at.toISOString(),
        actor: row.userId ? 'person' : support ? 'support' : 'system',
        who: row.userId ? { id: row.userId, name: names.get(row.userId) ?? 'Former user' } : null,
        entity: row.entity,
        entityLabel: AUDIT_ENTITY_LABELS[row.entity] ?? row.entity,
        entityId: row.entityId,
        action: row.action,
        actionLabel: auditActionLabel(row.action),
        changes,
      };
    });
  }

  async list(actor: AuthUser, query: AuditQuery): Promise<AuditPage> {
    await this.allow(actor);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const where = this.where(actor.collegeId, query);
      const total = await db.auditLog.count({ where });
      const rows = await db.auditLog.findMany({ where, orderBy: { at: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize });
      const users = await db.auditLog.findMany({ where: { collegeId: actor.collegeId, userId: { not: null } }, distinct: ['userId'], select: { userId: true } });
      const entities = await db.auditLog.findMany({ where: { collegeId: actor.collegeId }, distinct: ['entity'], select: { entity: true } });
      const people = await db.user.findMany({
        where: { collegeId: actor.collegeId, id: { in: users.map((u) => u.userId!) } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      return {
        items: await this.views(db, actor.collegeId, rows),
        page: query.page,
        pageSize: query.pageSize,
        total,
        people,
        entities: entities.map(({ entity }) => ({ key: entity, label: AUDIT_ENTITY_LABELS[entity] ?? entity })).sort((a, b) => a.label.localeCompare(b.label)),
      };
    });
  }

  /** The filtered log as CSV, newest first. Refuses more than AUDIT_EXPORT_LIMIT rows rather than cutting silently. */
  async csv(actor: AuthUser, query: AuditQuery): Promise<{ name: string; body: Buffer }> {
    await this.allow(actor);
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const where = this.where(actor.collegeId, query);
      const total = await db.auditLog.count({ where });
      if (total > AUDIT_EXPORT_LIMIT) {
        throw apiError(
          400,
          'too_many',
          `${total.toLocaleString('en-IN')} entries match. Narrow the filters to ${AUDIT_EXPORT_LIMIT.toLocaleString('en-IN')} or fewer to download.`,
        );
      }
      const rows = await db.auditLog.findMany({ where, orderBy: { at: 'desc' } });
      const views = await this.views(db, actor.collegeId, rows);
      const lines = [['When (India time)', 'Who', 'Record', 'Record id', 'Action', 'Changes'].join(',')];
      for (const v of views) {
        const who = v.actor === 'support' ? 'YuCampus support' : v.actor === 'system' ? 'YuCampus (automatic)' : v.who!.name;
        const changes = v.changes.map((c) => `${c.field}: ${c.before ?? '–'} → ${c.after ?? '–'}`).join('; ');
        lines.push([indiaTime(new Date(v.at)), who, v.entityLabel, v.entityId, v.actionLabel, changes].map(csvCell).join(','));
      }
      const range = query.from || query.to ? ` ${query.from ?? 'start'} to ${query.to ?? 'today'}` : '';
      // A byte-order mark so Excel reads the file as UTF-8 (₹, –, Indian names).
      return { name: `Audit log${range}.csv`, body: Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8') };
    });
  }
}
