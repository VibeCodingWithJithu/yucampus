import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  type PlatformAdminView,
  type PlatformAuditEntry,
  type PlatformCollegeDetail,
  type PlatformCollegeRow,
  type PlatformRuleFile,
  type PlatformRulesView,
  ROLE_LABELS,
  platformActionLabel,
} from '@yucampus/types';
import type { CollegePlanInput, CollegeStatusInput, CreateCollegeValues, PlatformCollegeQuery, PlatformInviteInput } from '@yucampus/validation';
import { PasswordLinksService } from '../auth/password-links.service.js';
import { apiError } from '../common/api-error.js';
import { isUniqueViolation, notFound } from '../common/params.js';
import { AppConfig } from '../config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';
import { PlatformAuthService, adminView } from './platform-auth.service.js';
import type { PlatformActor } from './platform-guard.js';

const RULES_DIR = path.resolve(import.meta.dirname, '../../rules');
const DAY = 86_400_000;
/** Written into a college's own audit log for actions by the YuCampus team. */
const SUPPORT = 'YuCampus support';

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const verifiedOf = (source: unknown) => isObject(source) && source.verified === true;

/**
 * The platform panel (docs/PRODUCT.md "Super-admin panel and audit log"). Reads colleges one at a time through
 * forTenant(), so row-level security still applies, and returns metadata and counts only: never evidence, register
 * records, survey answers or other personal data, apart from the college admins' and principal's contact details.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly links: PasswordLinksService,
    private readonly auth: PlatformAuthService,
  ) {}

  // ---------------------------------------------------------------- Colleges

  private async rowOf(db: TenantClient, collegeId: string): Promise<PlatformCollegeRow | null> {
    const college = await db.college.findUnique({ where: { id: collegeId } });
    if (!college) return null;
    const since = new Date(Date.now() - 30 * DAY);
    const users = await db.user.count({ where: { collegeId } });
    const active = await db.auditLog.findMany({ where: { collegeId, action: 'sign_in', at: { gte: since }, userId: { not: null } }, distinct: ['userId'], select: { userId: true } });
    const evidence = await db.evidence.count({ where: { collegeId } });
    const versions = await db.evidenceVersion.aggregate({ where: { collegeId }, _sum: { fileSize: true } });
    const current = await db.evidence.aggregate({ where: { collegeId }, _sum: { fileSize: true } });
    const registerRecords = await db.registerRecord.count({ where: { collegeId } });
    const last = await db.auditLog.findFirst({ where: { collegeId }, orderBy: { at: 'desc' }, select: { at: true } });
    return {
      id: college.id,
      name: college.name,
      type: college.type,
      subdomain: college.subdomain,
      state: college.state,
      plan: college.plan,
      status: college.status,
      createdAt: college.createdAt.toISOString(),
      users,
      activeUsers: active.length,
      evidence,
      // Versions include the current file; older rows may predate versions.
      storageBytes: Math.max(versions._sum.fileSize ?? 0, current._sum.fileSize ?? 0),
      registerRecords,
      lastActivityAt: last?.at.toISOString() ?? null,
    };
  }

  async colleges(query: PlatformCollegeQuery): Promise<PlatformCollegeRow[]> {
    const rows: PlatformCollegeRow[] = [];
    for (const id of await this.prisma.collegeIds()) {
      const row = await this.prisma.forTenant(id, (db) => this.rowOf(db, id));
      if (row) rows.push(row);
    }
    const term = query.search?.toLowerCase();
    return rows
      .filter((r) => !query.status || r.status === query.status)
      .filter((r) => !term || r.name.toLowerCase().includes(term) || r.subdomain.includes(term) || r.state.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async college(collegeId: string): Promise<PlatformCollegeDetail> {
    if (!(await this.prisma.collegeIds()).includes(collegeId)) throw notFound('college');
    const detail = await this.prisma.forTenant(collegeId, async (db) => {
      const row = await this.rowOf(db, collegeId);
      if (!row) return null;
      const college = await db.college.findUniqueOrThrow({ where: { id: collegeId } });
      const settings = isObject(college.settings) ? college.settings : {};
      const people = await db.user.findMany({
        where: { collegeId, roles: { some: { role: { in: ['college_admin', 'principal'] } } } },
        select: { name: true, email: true, mobile: true, status: true, roles: { select: { role: true } } },
        orderBy: { name: 'asc' },
      });
      const chosen = await db.collegeFramework.findMany({ where: { collegeId, active: true }, select: { frameworkId: true } });
      const programs = await db.programFramework.findMany({ where: { collegeId }, select: { frameworkId: true } });
      const ids = [...new Set([...chosen, ...programs].map((f) => f.frameworkId))];
      // Through this transaction, not this.prisma.rules: a second connection could wait on this one.
      const frameworks = await db.framework.findMany({ where: { id: { in: ids } }, select: { code: true, name: true, body: true }, orderBy: [{ body: 'asc' }, { name: 'asc' }] });
      return {
        ...row,
        url: this.config.appUrl(college.subdomain),
        city: typeof settings.city === 'string' ? settings.city : null,
        aisheCode: typeof settings.aisheCode === 'string' ? settings.aisheCode : null,
        contacts: people.flatMap((p) =>
          p.roles
            .filter((r) => r.role === 'college_admin' || r.role === 'principal')
            .map((r) => ({ name: p.name, email: p.email, mobile: p.mobile, role: ROLE_LABELS[r.role], status: p.status })),
        ),
        frameworks,
      };
    });
    if (!detail) throw notFound('college');
    const history = (await this.audit({ collegeId, take: 20 })).map((entry) => ({ ...entry, college: { id: collegeId, name: detail.name } }));
    return { ...detail, history };
  }

  /** Sets up a college with its first college admin, who gets an invite email. The college does the rest itself. */
  async createCollege(actor: PlatformActor, input: CreateCollegeValues): Promise<PlatformCollegeDetail> {
    if (await this.prisma.resolveCollegeId(input.subdomain)) throw apiError(409, 'subdomain_taken', `${input.subdomain} is already used by another college.`);
    let collegeId: string;
    try {
      collegeId = await this.prisma.createCollege({ name: input.name, type: input.type, subdomain: input.subdomain, state: input.state, plan: input.plan });
    } catch (error) {
      if (isUniqueViolation(error)) throw apiError(409, 'subdomain_taken', `${input.subdomain} is already used by another college.`);
      throw error;
    }
    const adminId = await this.prisma.forTenant(collegeId, async (db) => {
      const user = await db.user.create({
        data: { collegeId, name: input.adminName, email: input.adminEmail, status: 'invited', roles: { create: [{ collegeId, role: 'college_admin' }] } },
      });
      await db.auditLog.create({
        data: { collegeId, entity: 'college', entityId: collegeId, action: 'platform_create', after: { by: SUPPORT, name: input.name, subdomain: input.subdomain, plan: input.plan, collegeAdmin: input.adminEmail } },
      });
      return user.id;
    });
    await this.record(actor, 'college_create', collegeId, { name: input.name, subdomain: input.subdomain, plan: input.plan, collegeAdmin: input.adminEmail });
    await this.links.invite(collegeId, [adminId]);
    return this.college(collegeId);
  }

  async setStatus(actor: PlatformActor, collegeId: string, input: CollegeStatusInput): Promise<PlatformCollegeDetail> {
    await this.changeCollege(actor, collegeId, input.status === 'suspended' ? 'suspend' : 'reactivate', async (db, college) => {
      if (college.status === input.status) return null;
      await db.college.update({ where: { id: collegeId }, data: { status: input.status } });
      // Every session ends at its next refresh (within 15 minutes): sign-in and refresh refuse a suspended college,
      // and the refresh tokens go too, so reactivating does not bring old sessions back.
      if (input.status === 'suspended') await db.refreshToken.deleteMany({ where: { collegeId } });
      return { before: { status: college.status }, after: { status: input.status, reason: input.reason } };
    });
    return this.college(collegeId);
  }

  async setPlan(actor: PlatformActor, collegeId: string, input: CollegePlanInput): Promise<PlatformCollegeDetail> {
    await this.changeCollege(actor, collegeId, 'plan', async (db, college) => {
      if (college.plan === input.plan) return null;
      await db.college.update({ where: { id: collegeId }, data: { plan: input.plan } });
      return { before: { plan: college.plan }, after: { plan: input.plan } };
    });
    return this.college(collegeId);
  }

  /** Emails the college's invited admins their invite again (e.g. the first email was lost). */
  async resendInvite(actor: PlatformActor, collegeId: string): Promise<{ sent: number }> {
    if (!(await this.prisma.collegeIds()).includes(collegeId)) throw notFound('college');
    const ids = await this.prisma.forTenant(collegeId, (db) =>
      db.user.findMany({ where: { collegeId, status: 'invited', email: { not: null }, roles: { some: { role: 'college_admin' } } }, select: { id: true } }),
    );
    if (ids.length === 0) throw apiError(409, 'nothing_to_send', 'Every college admin of this college has already signed in.');
    await this.links.invite(collegeId, ids.map((u) => u.id));
    await this.record(actor, 'college_resend_invite', collegeId, { people: ids.length });
    return { sent: ids.length };
  }

  private async changeCollege(
    actor: PlatformActor,
    collegeId: string,
    kind: 'suspend' | 'reactivate' | 'plan',
    change: (db: TenantClient, college: { status: string; plan: string }) => Promise<{ before: Record<string, unknown>; after: Record<string, unknown> } | null>,
  ) {
    if (!(await this.prisma.collegeIds()).includes(collegeId)) throw notFound('college');
    const done = await this.prisma.forTenant(collegeId, async (db) => {
      const college = await db.college.findUniqueOrThrow({ where: { id: collegeId }, select: { status: true, plan: true } });
      const result = await change(db, college);
      if (result) {
        await db.auditLog.create({
          data: { collegeId, entity: 'college', entityId: collegeId, action: `platform_${kind}`, before: result.before as Prisma.InputJsonObject, after: { by: SUPPORT, ...result.after } as Prisma.InputJsonObject },
        });
      }
      return result;
    });
    if (done) await this.record(actor, `college_${kind}`, collegeId, done);
  }

  // ---------------------------------------------------------------- Rules (read only)

  async rules(): Promise<PlatformRulesView> {
    const used = new Map<string, Set<string>>();
    for (const collegeId of await this.prisma.collegeIds()) {
      await this.prisma.forTenant(collegeId, async (db) => {
        const rows = [
          ...(await db.collegeFramework.findMany({ where: { collegeId, active: true }, select: { frameworkId: true } })),
          ...(await db.programFramework.findMany({ where: { collegeId }, select: { frameworkId: true } })),
        ];
        for (const { frameworkId } of rows) used.set(frameworkId, (used.get(frameworkId) ?? new Set()).add(collegeId));
      });
    }
    const frameworks = await this.prisma.rules.framework.findMany({ orderBy: [{ body: 'asc' }, { code: 'asc' }, { version: 'asc' }] });
    const registers = await this.prisma.platform.registerDefinition.findMany({ orderBy: [{ sortOrder: 'asc' }, { version: 'asc' }] });
    return {
      frameworks: frameworks.map((f) => ({
        code: f.code,
        version: f.version,
        name: f.name,
        body: f.body,
        status: f.status,
        verified: verifiedOf(f.source),
        colleges: used.get(f.id)?.size ?? 0,
      })),
      registers: registers.map((r) => ({
        code: r.code,
        version: r.version,
        name: r.name,
        status: r.status,
        verified: isObject(r.definition) && verifiedOf(r.definition.source),
      })),
      files: this.ruleFiles(),
    };
  }

  /** Rules kept as files and read by the API directly (NBA, NIRF, AISHE, surveys). */
  private ruleFiles(): PlatformRuleFile[] {
    const out: PlatformRuleFile[] = [];
    for (const area of ['nba', 'nirf', 'aishe', 'surveys']) {
      let names: string[] = [];
      try {
        names = readdirSync(path.join(RULES_DIR, area)).filter((f) => f.endsWith('.json')).sort();
      } catch {
        continue;
      }
      for (const file of names) {
        try {
          const raw = JSON.parse(readFileSync(path.join(RULES_DIR, area, file), 'utf8')) as Record<string, unknown>;
          const source = isObject(raw.source) ? raw.source : {};
          out.push({
            area: area.toUpperCase() === 'SURVEYS' ? 'Surveys' : area.toUpperCase(),
            file: `${area}/${file}`,
            version: typeof raw.version === 'string' ? raw.version : '–',
            title: typeof source.title === 'string' ? source.title : '',
            verified: source.verified === true,
          });
        } catch {
          out.push({ area: area.toUpperCase(), file: `${area}/${file}`, version: '–', title: 'Could not be read', verified: false });
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- Team

  async admins(): Promise<PlatformAdminView[]> {
    const rows = await this.prisma.platform.platformAdmin.findMany({ orderBy: { name: 'asc' } });
    return rows.map(adminView);
  }

  async invite(actor: PlatformActor, input: PlatformInviteInput): Promise<PlatformAdminView> {
    let admin;
    try {
      admin = await this.prisma.platform.platformAdmin.create({ data: { email: input.email, name: input.name, status: 'invited', invitedById: actor.id } });
    } catch (error) {
      if (isUniqueViolation(error)) throw apiError(409, 'email_taken', 'That email already has a team account.');
      throw error;
    }
    await this.record(actor, 'admin_invite', null, { adminId: admin.id, email: admin.email });
    await this.auth.sendLinkLater(admin.id, 'invite');
    return adminView(admin);
  }

  async setAdminEnabled(actor: PlatformActor, adminId: string, enabled: boolean): Promise<PlatformAdminView> {
    if (adminId === actor.id) throw apiError(409, 'own_account', 'You cannot disable your own account. Ask another team member.');
    const admin = await this.prisma.platformTransaction(async (db) => {
      const before = await db.platformAdmin.findUnique({ where: { id: adminId } });
      if (!before) throw notFound('team member');
      const status = enabled ? (before.passwordHash ? 'active' : 'invited') : 'disabled';
      const after = await db.platformAdmin.update({ where: { id: adminId }, data: { status } });
      if (!enabled) await db.platformRefreshToken.deleteMany({ where: { adminId } });
      await db.platformAuditLog.create({ data: { adminId: actor.id, action: enabled ? 'admin_enable' : 'admin_disable', detail: { adminId, email: before.email } } });
      return after;
    });
    return adminView(admin);
  }

  /** Clears a team member's authenticator and recovery codes (e.g. a lost phone) and ends their sessions. */
  async resetMfa(actor: PlatformActor, adminId: string): Promise<PlatformAdminView> {
    if (adminId === actor.id) throw apiError(409, 'own_account', 'Ask another team member to reset your authenticator.');
    const admin = await this.prisma.platformTransaction(async (db) => {
      const before = await db.platformAdmin.findUnique({ where: { id: adminId } });
      if (!before) throw notFound('team member');
      const after = await db.platformAdmin.update({ where: { id: adminId }, data: { totpSecret: null, totpConfirmedAt: null, totpLastStep: null } });
      await db.platformRecoveryCode.deleteMany({ where: { adminId } });
      await db.platformRefreshToken.deleteMany({ where: { adminId } });
      await db.platformAuditLog.create({ data: { adminId: actor.id, action: 'admin_reset_mfa', detail: { adminId, email: before.email } } });
      return after;
    });
    return adminView(admin);
  }

  /** Emails a team member a link to choose a password (invite again, or reset). */
  async sendPasswordLink(actor: PlatformActor, adminId: string): Promise<{ sent: true }> {
    const admin = await this.prisma.platform.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin || admin.status === 'disabled') throw notFound('team member');
    await this.record(actor, 'admin_reset', null, { adminId, email: admin.email });
    await this.auth.sendLinkLater(adminId, admin.passwordHash ? 'reset' : 'invite');
    return { sent: true };
  }

  // ---------------------------------------------------------------- Platform audit log

  private async record(actor: PlatformActor, action: string, collegeId: string | null, detail: Record<string, unknown>) {
    await this.prisma.platform.platformAuditLog.create({ data: { adminId: actor.id, action, collegeId, detail: detail as Prisma.InputJsonObject } });
  }

  async audit({ collegeId, take = 100 }: { collegeId?: string; take?: number } = {}): Promise<PlatformAuditEntry[]> {
    const rows = await this.prisma.platform.platformAuditLog.findMany({ where: collegeId ? { collegeId } : {}, orderBy: { at: 'desc' }, take: Math.min(take, 200) });
    const admins = new Map(
      (await this.prisma.platform.platformAdmin.findMany({ where: { id: { in: rows.map((r) => r.adminId).filter((id): id is string => Boolean(id)) } }, select: { id: true, name: true } })).map((a) => [a.id, a]),
    );
    const names = new Map<string, string>();
    for (const id of new Set(rows.map((r) => r.collegeId).filter((id): id is string => Boolean(id)))) {
      const college = await this.prisma.forTenant(id, (db) => db.college.findUnique({ where: { id }, select: { name: true } }));
      if (college) names.set(id, college.name);
    }
    return rows.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      admin: row.adminId ? (admins.get(row.adminId) ?? { id: row.adminId, name: 'Former team member' }) : null,
      action: row.action,
      actionLabel: platformActionLabel(row.action),
      college: row.collegeId ? { id: row.collegeId, name: names.get(row.collegeId) ?? 'Unknown college' } : null,
      detail: isObject(row.detail) ? row.detail : {},
    }));
  }
}
