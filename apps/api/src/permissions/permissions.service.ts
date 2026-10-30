import { Injectable } from '@nestjs/common';
import {
  type CollegeRole,
  type Grant,
  PERMISSIONS,
  type Permission,
  type PermissionAdjustment,
  ROLE_TEMPLATES,
  type RoleAssignment,
  type Scope,
  can,
  effectiveGrants,
} from '@yucampus/types';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';

export interface PermissionCell {
  role: CollegeRole;
  permission: Permission;
  scope: Scope;
  /** The YuCampus default for this role. */
  defaultOn: boolean;
  /** What applies in this college now. */
  allowed: boolean;
  /** The college has changed this entry from the default. */
  adjusted: boolean;
  /** Nobody can change it (safety rule). */
  locked: boolean;
  /** The person asking may change it. */
  editable: boolean;
}

/** How long a college's adjustments are reused before being read again. Changes made here clear it at once. */
const CACHE_MS = 30_000;

@Injectable()
export class PermissionsService {
  // One API process today. With several processes, a change made in one reaches the others within CACHE_MS.
  private readonly cache = new Map<string, { at: number; adjustments: PermissionAdjustment[] }>();

  constructor(private readonly prisma: PrismaService) {}

  async adjustments(collegeId: string, db?: TenantClient): Promise<PermissionAdjustment[]> {
    const cached = this.cache.get(collegeId);
    if (!db && cached && Date.now() - cached.at < CACHE_MS) return cached.adjustments;
    const read = (client: TenantClient) =>
      client.collegeRolePermission.findMany({
        where: { collegeId },
        select: { role: true, permission: true, allowed: true },
      });
    const rows = db ? await read(db) : await this.prisma.forTenant(collegeId, read);
    const adjustments = rows
      .filter((row) => row.role !== 'super_admin' && (PERMISSIONS as readonly string[]).includes(row.permission))
      .map((row) => ({ role: row.role as CollegeRole, permission: row.permission as Permission, allowed: row.allowed }));
    this.cache.set(collegeId, { at: Date.now(), adjustments });
    return adjustments;
  }

  async grantsFor(collegeId: string, roles: readonly RoleAssignment[], db?: TenantClient): Promise<Grant[]> {
    return effectiveGrants(roles, await this.adjustments(collegeId, db));
  }

  /** The whole table for the "What each role can do" screen, marking what the asker may change. */
  async matrix(actor: AuthUser): Promise<PermissionCell[]> {
    const grants = await this.grantsFor(actor.collegeId, actor.roles);
    const adjusted = new Map((await this.adjustments(actor.collegeId)).map((a) => [`${a.role}:${a.permission}`, a.allowed]));
    const cells: PermissionCell[] = [];
    for (const [role, entries] of Object.entries(ROLE_TEMPLATES) as [CollegeRole, (typeof ROLE_TEMPLATES)[CollegeRole]][]) {
      for (const permission of PERMISSIONS) {
        const entry = entries[permission];
        if (!entry) continue;
        const override = entry.locked ? undefined : adjusted.get(`${role}:${permission}`);
        cells.push({
          role,
          permission,
          scope: entry.scope,
          defaultOn: entry.on,
          allowed: override ?? entry.on,
          adjusted: override !== undefined && override !== entry.on,
          locked: Boolean(entry.locked),
          editable: !entry.locked && this.mayChange(grants, role, permission),
        });
      }
    }
    return cells;
  }

  /** Switches one template entry on or off for the actor's college. */
  async update(actor: AuthUser, change: PermissionAdjustment): Promise<PermissionCell[]> {
    const entry = ROLE_TEMPLATES[change.role]?.[change.permission];
    if (!entry) throw apiError(400, 'invalid_input', 'That role cannot have that permission.');
    if (entry.locked) {
      throw apiError(409, 'permission_locked', 'This permission cannot be changed, so the college can never lock itself out.');
    }

    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const before = await this.adjustments(actor.collegeId, db);
      const grantsBefore = effectiveGrants(actor.roles, before);
      if (!this.mayChange(grantsBefore, change.role, change.permission)) {
        throw apiError(403, 'forbidden', 'You cannot change this permission. Ask your college admin.');
      }
      const after = [...before.filter((a) => a.role !== change.role || a.permission !== change.permission), change];
      if (can(grantsBefore, 'users_setup.manage', ['college']) && !can(effectiveGrants(actor.roles, after), 'users_setup.manage', ['college'])) {
        throw apiError(409, 'cannot_remove_own_access', 'You cannot take away your own permission to manage users. Ask another admin.');
      }

      const where = { collegeId_role_permission: { collegeId: actor.collegeId, role: change.role, permission: change.permission } };
      const previous = before.find((a) => a.role === change.role && a.permission === change.permission);
      if (change.allowed === entry.on) {
        // Back to the default: no row, so a later change of the default reaches this college too.
        await db.collegeRolePermission.deleteMany({ where: { collegeId: actor.collegeId, role: change.role, permission: change.permission } });
      } else {
        await db.collegeRolePermission.upsert({
          where,
          create: { collegeId: actor.collegeId, ...change, changedBy: actor.id },
          update: { allowed: change.allowed, changedBy: actor.id, changedAt: new Date() },
        });
      }
      await audit(db, actor, 'permission', `${change.role}:${change.permission}`, 'update', {
        before: { allowed: previous?.allowed ?? entry.on },
        after: { allowed: change.allowed },
      });
    });
    this.cache.delete(actor.collegeId);
    return this.matrix(actor);
  }

  private mayChange(grants: readonly Grant[], role: CollegeRole, permission: Permission): boolean {
    if (can(grants, 'permissions.manage')) return true;
    // The principal's narrow right: give IQAC "Manage users and setup", or take it back.
    return role === 'iqac' && permission === 'users_setup.manage' && can(grants, 'iqac_setup.grant');
  }
}
