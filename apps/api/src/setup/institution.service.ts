import { Injectable } from '@nestjs/common';
import type { CycleView, FrameworksView, InstitutionProfile, SetupStep, SsoSettingsView } from '@yucampus/types';
import type { CollegeFrameworksInput, CycleInput, InstitutionProfileValues, SsoSettingsValues } from '@yucampus/validation';
import { ssoSettingsOf } from '../auth/sso.service.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { AppConfig } from '../config.js';
import { apiError } from '../common/api-error.js';
import { audit } from '../common/audit.js';
import { fromIsoDate, isUniqueViolation, notFound, toIsoDate } from '../common/params.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Profile fields kept in colleges.settings (the rest are columns). */
interface ProfileSettings {
  city?: string | null;
  aisheCode?: string | null;
  affiliatingUniversity?: string | null;
  establishedYear?: number | null;
  approvalLevels?: 1 | 2;
  profileSavedAt?: string;
}

const settingsOf = (value: Prisma.JsonValue): ProfileSettings =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as ProfileSettings) : {};

@Injectable()
export class InstitutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Sign-in with Google or Microsoft for this college (decided 2026-10-21). */
  async getSso(actor: AuthUser): Promise<SsoSettingsView> {
    const college = await this.prisma.forTenant(actor.collegeId, (db) => db.college.findUniqueOrThrow({ where: { id: actor.collegeId }, select: { settings: true } }));
    return { ...ssoSettingsOf(college.settings), available: { google: Boolean(this.config.sso.google), microsoft: Boolean(this.config.sso.microsoft) } };
  }

  async updateSso(actor: AuthUser, input: SsoSettingsValues): Promise<SsoSettingsView> {
    for (const provider of ['google', 'microsoft'] as const) {
      if (input[provider] && !this.config.sso[provider]) {
        throw apiError(400, 'sso_unavailable', `Sign-in with ${provider === 'google' ? 'Google' : 'Microsoft'} is not set up on this server yet.`);
      }
    }
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const before = await db.college.findUniqueOrThrow({ where: { id: actor.collegeId }, select: { settings: true } });
      const settings = { ...settingsOf(before.settings), sso: { google: input.google, microsoft: input.microsoft, domains: input.domains } };
      await db.college.update({ where: { id: actor.collegeId }, data: { settings: settings as Prisma.InputJsonObject } });
      await audit(db, actor, 'college', actor.collegeId, 'update_sso', { before: ssoSettingsOf(before.settings), after: settings.sso });
    });
    return this.getSso(actor);
  }

  async getProfile(actor: AuthUser): Promise<InstitutionProfile> {
    const college = await this.prisma.forTenant(actor.collegeId, (db) =>
      db.college.findUniqueOrThrow({ where: { id: actor.collegeId } }),
    );
    const settings = settingsOf(college.settings);
    return {
      name: college.name,
      type: college.type,
      state: college.state,
      subdomain: college.subdomain,
      city: settings.city ?? null,
      aisheCode: settings.aisheCode ?? null,
      affiliatingUniversity: settings.affiliatingUniversity ?? null,
      establishedYear: settings.establishedYear ?? null,
      approvalLevels: settings.approvalLevels ?? 2,
    };
  }

  async updateProfile(actor: AuthUser, input: InstitutionProfileValues): Promise<InstitutionProfile> {
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      const before = await db.college.findUniqueOrThrow({ where: { id: actor.collegeId } });
      const { name, type, state, ...extra } = input;
      const settings: ProfileSettings = {
        ...settingsOf(before.settings),
        city: extra.city ?? null,
        aisheCode: extra.aisheCode ?? null,
        affiliatingUniversity: extra.affiliatingUniversity ?? null,
        establishedYear: extra.establishedYear ?? null,
        approvalLevels: extra.approvalLevels === 1 ? 1 : 2,
        profileSavedAt: new Date().toISOString(),
      };
      await db.college.update({
        where: { id: actor.collegeId },
        data: { name, type, state, settings: settings as Prisma.InputJsonObject },
      });
      await audit(db, actor, 'college', actor.collegeId, 'update_profile', {
        before: { name: before.name, type: before.type, state: before.state, settings: before.settings },
        after: { name, type, state, settings },
      });
    });
    return this.getProfile(actor);
  }

  async listFrameworks(actor: AuthUser): Promise<FrameworksView> {
    const [frameworks, mine] = await Promise.all([
      this.prisma.rules.framework.findMany({
        where: { status: { not: 'retired' } },
        include: { _count: { select: { criteria: true } } },
        orderBy: [{ body: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.forTenant(actor.collegeId, async (db) => ({
        cycles: await db.assessmentCycle.findMany({ where: { collegeId: actor.collegeId }, orderBy: { createdAt: 'asc' } }),
        rows: await db.collegeFramework.findMany({
          where: { collegeId: actor.collegeId },
          select: { frameworkId: true, cycleId: true, active: true },
        }),
      })),
    ]);
    return {
      options: frameworks.map(({ _count, validFrom: _validFrom, ...framework }) => ({ ...framework, criteriaCount: _count.criteria })),
      cycles: mine.cycles.map(
        (cycle): CycleView => ({
          id: cycle.id,
          body: cycle.body,
          label: cycle.label,
          status: cycle.status,
          startDate: cycle.startDate ? toIsoDate(cycle.startDate) : null,
          endDate: cycle.endDate ? toIsoDate(cycle.endDate) : null,
        }),
      ),
      college: mine.rows,
    };
  }

  async addCycle(actor: AuthUser, input: CycleInput): Promise<FrameworksView> {
    try {
      await this.prisma.forTenant(actor.collegeId, async (db) => {
        const cycle = await db.assessmentCycle.create({
          data: {
            collegeId: actor.collegeId,
            body: input.body,
            label: input.label,
            startDate: input.startDate ? fromIsoDate(input.startDate) : null,
            endDate: input.endDate ? fromIsoDate(input.endDate) : null,
          },
        });
        await audit(db, actor, 'assessment_cycle', cycle.id, 'create', { after: input });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw apiError(409, 'cycle_exists', `There is already a ${input.body} cycle called "${input.label}".`);
      throw error;
    }
    return this.listFrameworks(actor);
  }

  /**
   * Makes exactly these frameworks of one body active for the college (in one cycle). Others of that body in
   * that cycle are switched off but kept, so their data stays. Framework.selection decides how many may be
   * active at once: "single" (NAAC) allows one, "multiple" (NIRF categories) allows several.
   */
  async setCollegeFrameworks(actor: AuthUser, input: CollegeFrameworksInput): Promise<FrameworksView> {
    const ids = [...new Set(input.frameworkIds)];
    const ofBody = await this.prisma.rules.framework.findMany({
      where: { body: input.body, attachesTo: 'college', status: { not: 'retired' } },
      select: { id: true, selection: true },
    });
    const allowed = new Map(ofBody.map((framework) => [framework.id, framework]));
    if (ids.some((id) => !allowed.has(id))) {
      throw apiError(400, 'invalid_input', `One of those is not a ${input.body} framework a college can choose.`);
    }
    if (ids.length > 1 && ids.some((id) => allowed.get(id)!.selection === 'single')) {
      throw apiError(400, 'one_framework_only', `Only one ${input.body} framework can be active at a time${input.cycleId ? ' in a cycle' : ''}.`);
    }

    await this.prisma.forTenant(actor.collegeId, async (db) => {
      if (input.cycleId) {
        const cycle = await db.assessmentCycle.findFirst({ where: { id: input.cycleId, collegeId: actor.collegeId, body: input.body } });
        if (!cycle) throw notFound('assessment cycle');
      }
      const scope = { collegeId: actor.collegeId, cycleId: input.cycleId, frameworkId: { in: [...allowed.keys()] } };
      const before = await db.collegeFramework.findMany({ where: { ...scope, active: true }, select: { frameworkId: true } });
      const now = new Date();
      await db.collegeFramework.updateMany({
        where: { ...scope, active: true, frameworkId: { in: [...allowed.keys()].filter((id) => !ids.includes(id)) } },
        data: { active: false, retiredAt: now },
      });
      for (const frameworkId of ids) {
        const existing = await db.collegeFramework.findFirst({ where: { collegeId: actor.collegeId, cycleId: input.cycleId, frameworkId } });
        if (existing) {
          if (!existing.active) await db.collegeFramework.update({ where: { id: existing.id }, data: { active: true, retiredAt: null } });
        } else {
          await db.collegeFramework.create({ data: { collegeId: actor.collegeId, cycleId: input.cycleId, frameworkId } });
        }
      }
      await audit(db, actor, 'college', actor.collegeId, 'set_frameworks', {
        before: { body: input.body, cycleId: input.cycleId, active: before.map((row) => row.frameworkId) },
        after: { body: input.body, cycleId: input.cycleId, active: ids },
      });
    });
    return this.listFrameworks(actor);
  }

  /** The five onboarding steps and how far the college has got. */
  async progress(actor: AuthUser): Promise<SetupStep[]> {
    const facts = await this.prisma.forTenant(actor.collegeId, async (db) => {
      const where = { collegeId: actor.collegeId };
      const [college, departments, departmentsWithoutPrograms, users, notJoined, hods, iqac, current] =
        await Promise.all([
          db.college.findUniqueOrThrow({ where: { id: actor.collegeId }, select: { settings: true } }),
          db.department.count({ where }),
          db.department.count({ where: { ...where, programs: { none: {} } } }),
          db.user.count({ where }),
          db.user.count({ where: { ...where, status: { not: 'active' } } }),
          db.userRole.count({ where: { ...where, role: 'hod' } }),
          db.userRole.count({ where: { ...where, role: 'iqac' } }),
          db.academicYear.findFirst({
            where: { ...where, status: 'current' },
            select: { label: true, _count: { select: { keyDates: true } } },
          }),
        ]);
      return { college, departments, departmentsWithoutPrograms, users, notJoined, hods, iqac, current };
    });

    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    const steps: (Omit<SetupStep, 'state'> & { done: boolean | null })[] = [
      {
        key: 'profile',
        title: 'Institution profile',
        done: Boolean(settingsOf(facts.college.settings).profileSavedAt),
        detail: settingsOf(facts.college.settings).profileSavedAt ? 'Saved' : 'Check and save',
      },
      {
        key: 'departments',
        title: 'Departments and programs',
        done: facts.departments > 0 && facts.departmentsWithoutPrograms === 0,
        detail:
          facts.departmentsWithoutPrograms > 0
            ? `${plural(facts.departmentsWithoutPrograms, 'department')} without programs`
            : plural(facts.departments, 'department'),
      },
      {
        key: 'users',
        title: 'Users and roles',
        done: facts.departments > 0 && facts.hods >= facts.departments && facts.iqac > 0,
        detail:
          facts.hods < facts.departments
            ? `${plural(facts.departments - facts.hods, 'department')} without a head`
            : facts.iqac === 0
              ? 'No IQAC coordinator yet'
              : `${plural(facts.users, 'person')}${facts.notJoined ? ` · ${facts.notJoined} not signed in yet` : ''}`.replace(
                  'persons',
                  'people',
                ),
      },
      {
        key: 'calendar',
        title: 'Academic year and calendar',
        done: Boolean(facts.current && facts.current._count.keyDates > 0),
        detail: !facts.current
          ? 'No current year'
          : facts.current._count.keyDates > 0
            ? `${facts.current.label} · ${plural(facts.current._count.keyDates, 'key date')}`
            : `Add key dates for ${facts.current.label}`,
      },
      { key: 'templates', title: 'Coordinators and task templates', done: null, detail: 'Comes with tasks' },
    ];

    const firstOpen = steps.findIndex((step) => step.done === false);
    return steps.map(({ done, ...step }, index) => ({
      ...step,
      state: done === null ? 'later' : done ? 'done' : index === firstOpen ? 'current' : 'todo',
    }));
  }
}
