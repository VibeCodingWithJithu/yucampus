// The platform panel for the YuCampus team: separate sign-in and tokens, what it shows of colleges (metadata and
// counts only), onboarding, suspension, plans, the read-only rules view, team accounts, and both audit logs.

import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createCollegeSchema } from '@yucampus/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { PlatformRoute } from '../src/auth/decorators.js';
import { OtpSender } from '../src/auth/otp-sender.js';
import { TokensService } from '../src/auth/tokens.service.js';
import { AppConfig } from '../src/config.js';
import { InProcessJobs } from '../src/jobs/jobs.js';
import { ConsoleEmailSender } from '../src/mail/email-sender.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { PlatformAuthService } from '../src/platform/platform-auth.service.js';
import { type PlatformActor, PlatformGuard } from '../src/platform/platform-guard.js';
import { PlatformService } from '../src/platform/platform.service.js';
import { STEP_SECONDS, base32Encode, stepAt, totpCode, verifyTotp } from '../src/platform/totp.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SAMPLE_PASSWORD, SAMPLE_PLATFORM_ADMIN, seed } from '../src/prisma/seed-data.js';
import { linksFor } from './notifications-for.js';

class SilentOtpSender extends OtpSender {
  async send() {}
}

const config = new AppConfig();
const tokens = new TokensService(config);
let database: Database;
let prisma: PrismaService;
let platformAuth: PlatformAuthService;
let platform: PlatformService;
let collegeAuth: AuthService;
let collegeMail: ConsoleEmailSender;
const teamMail = new ConsoleEmailSender();
let me: PlatformActor;
let sampleId: string;

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof HttpException) return (error.getResponse() as { code: string }).code;
    throw error;
  }
  return 'no_error';
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const tokenIn = (mail: ConsoleEmailSender, to: string) => new URL([...mail.sent].reverse().find((m) => m.to === to)!.action!.url).searchParams.get('token')!;

/** Authenticator secrets seen at set-up, by email: this test plays the phone. */
const phones = new Map<string, string>();

/** The next code the phone would show that the server has not seen yet (within the allowed clock drift). */
async function nextCode(email: string): Promise<string> {
  const admin = await prisma.platform.platformAdmin.findUniqueOrThrow({ where: { email } });
  const now = stepAt();
  const step = [now - 1, now, now + 1].find((s) => admin.totpLastStep === null || s > admin.totpLastStep);
  if (step === undefined) throw new Error('No unused code left in this 30-second window');
  return totpCode(phones.get(email)!, step);
}

/** Both sign-in steps; sets up the authenticator the first time. */
async function signIn(email: string, password: string) {
  const challenge = await platformAuth.login(email, password);
  if (challenge.enroll) phones.set(email, challenge.enroll.secret);
  return platformAuth.verifyMfa(challenge.ticket, await nextCode(email));
}

class Routes {
  @PlatformRoute()
  signedIn() {}
}

/** Runs PlatformGuard as Nest would for a signed-in platform route. */
async function guardAllows(token: string): Promise<boolean> {
  const guard = new PlatformGuard(new Reflector(), tokens, prisma);
  const request = { headers: { authorization: `Bearer ${token}` } };
  const context = {
    getHandler: () => Routes.prototype.signedIn,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    return await guard.canActivate(context);
  } catch {
    return false;
  }
}

beforeAll(async () => {
  database = await openLocalDatabase({ setup: (owner) => seed(owner) });
  prisma = new PrismaService(database);
  const links = linksFor(prisma, config, true);
  collegeMail = links.email;
  const jobs = new InProcessJobs();
  platformAuth = new PlatformAuthService(prisma, tokens, config, jobs, teamMail);
  platformAuth.onModuleInit();
  platform = new PlatformService(prisma, config, links.links, platformAuth);
  collegeAuth = new AuthService(prisma, tokens, new SilentOtpSender(), config, new PermissionsService(prisma), links.links);
  const admin = await prisma.platform.platformAdmin.findUniqueOrThrow({ where: { email: SAMPLE_PLATFORM_ADMIN.email } });
  me = { id: admin.id, name: admin.name, email: admin.email };
  sampleId = (await prisma.resolveCollegeId('sample'))!;
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('Platform sign-in', () => {
  it('signs a team member in with a platform token that college routes refuse, and the other way round', async () => {
    const started = await signIn(SAMPLE_PLATFORM_ADMIN.email, SAMPLE_PASSWORD);
    expect(started.session.admin.email).toBe(SAMPLE_PLATFORM_ADMIN.email);
    expect(await tokens.verifyPlatformToken(started.session.accessToken)).toBe(me.id);
    expect(await tokens.verifyAccessToken(started.session.accessToken)).toBeNull();
    expect(await guardAllows(started.session.accessToken)).toBe(true);

    const college = await collegeAuth.loginWithPassword('sample', 'admin@sample-college.example', SAMPLE_PASSWORD);
    expect(await tokens.verifyPlatformToken(college.session.accessToken)).toBeNull();
    expect(await guardAllows(college.session.accessToken)).toBe(false);
  });

  it('gives one answer for an unknown email and a wrong password; a college account is not a team account', async () => {
    expect(await codeOf(platformAuth.login('nobody@yucampus.example', SAMPLE_PASSWORD))).toBe('invalid_credentials');
    expect(await codeOf(platformAuth.login('admin@sample-college.example', SAMPLE_PASSWORD))).toBe('invalid_credentials');
    expect(await codeOf(platformAuth.login(SAMPLE_PLATFORM_ADMIN.email, 'wrong-password'))).toBe('invalid_credentials');
  });

  it('rotates refresh tokens and ends every session when an old one comes back', async () => {
    const first = await signIn(SAMPLE_PLATFORM_ADMIN.email, SAMPLE_PASSWORD);
    const second = await platformAuth.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await prisma.platform.platformRefreshToken.updateMany({ where: { revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 60_000) } });
    expect(await codeOf(platformAuth.refresh(first.refreshToken))).toBe('session_expired');
    expect(await codeOf(platformAuth.refresh(second.refreshToken))).toBe('session_expired');
  });
});

describe('Authenticator step', () => {
  it('computes codes as RFC 6238 does', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    // RFC 6238 test vectors (SHA-1), last 6 digits.
    expect(totpCode(secret, Math.floor(59 / STEP_SECONDS))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / STEP_SECONDS))).toBe('081804');
    expect(totpCode(secret, Math.floor(2000000000 / STEP_SECONDS))).toBe('279037');
    // One step of drift either way, and never a step already used.
    const at = 1111111109_000;
    expect(verifyTotp(secret, '081804', null, at + 30_000)).toBe(37037036);
    expect(verifyTotp(secret, '081804', null, at + 90_000)).toBeNull();
    expect(verifyTotp(secret, '081804', 37037036, at)).toBeNull();
  });

  it('makes a new team member set up the app, gives recovery codes once, and stores the secret encrypted', async () => {
    const email = 'third@yucampus.example';
    const invited = await platform.invite(me, { name: 'Third Team Member', email });
    await settle();
    const challenge = await platformAuth.setPassword(tokenIn(teamMail, email), 'Team@123456');
    expect(challenge.step).toBe('enroll');
    expect(challenge.enroll!.otpauthUrl).toContain(`secret=${challenge.enroll!.secret}`);
    phones.set(email, challenge.enroll!.secret);
    const row = await prisma.platform.platformAdmin.findUniqueOrThrow({ where: { id: invited.id } });
    expect(row.totpSecret).not.toContain(challenge.enroll!.secret);
    expect(row.totpConfirmedAt).toBeNull();

    // The ticket is not a session.
    expect(await guardAllows(challenge.ticket)).toBe(false);
    expect(await tokens.verifyAccessToken(challenge.ticket)).toBeNull();
    expect(await codeOf(platformAuth.verifyMfa(challenge.ticket, '000000'))).toBe('invalid_code');
    expect(await codeOf(platformAuth.verifyMfa('not-a-real-ticket-at-all-x', await nextCode(email)))).toBe('ticket_expired');

    const started = await platformAuth.verifyMfa(challenge.ticket, await nextCode(email));
    expect(started.session.admin.mfa).toBe(true);
    expect(started.session.recoveryCodes).toHaveLength(10);
    expect(await guardAllows(started.session.accessToken)).toBe(true);

    // Next time: just the code step, no secret, no recovery codes.
    const again = await platformAuth.login(email, 'Team@123456');
    expect(again).toMatchObject({ step: 'code' });
    expect(again.enroll).toBeUndefined();
    const code = await nextCode(email);
    expect((await platformAuth.verifyMfa(again.ticket, code)).session.recoveryCodes).toBeUndefined();
    // The same code cannot be used twice.
    const third = await platformAuth.login(email, 'Team@123456');
    expect(await codeOf(platformAuth.verifyMfa(third.ticket, code))).toBe('invalid_code');

    // A recovery code works once, written with or without the hyphen.
    const recovery = started.session.recoveryCodes![0]!;
    expect(await codeOf(platformAuth.verifyMfa(third.ticket, recovery.toUpperCase().replace('-', '')))).toBe('no_error');
    const fourth = await platformAuth.login(email, 'Team@123456');
    expect(await codeOf(platformAuth.verifyMfa(fourth.ticket, recovery))).toBe('invalid_code');
  });

  it('locks after repeated wrong codes, like wrong passwords', async () => {
    const email = 'third@yucampus.example';
    const challenge = await platformAuth.login(email, 'Team@123456');
    await prisma.platform.platformAdmin.update({ where: { email }, data: { failedLogins: 0 } });
    const codes = [];
    for (let i = 0; i < config.loginMaxFailures; i++) codes.push(await codeOf(platformAuth.verifyMfa(challenge.ticket, '111111')));
    expect(codes.slice(0, -1).every((c) => c === 'invalid_code')).toBe(true);
    expect(codes.at(-1)).toBe('account_locked');
    await prisma.platform.platformAdmin.update({ where: { email }, data: { lockedUntil: null, failedLogins: 0 } });
  });

  it('lets another team member reset a lost authenticator; the person sets it up again', async () => {
    const email = 'third@yucampus.example';
    const admin = await prisma.platform.platformAdmin.findUniqueOrThrow({ where: { email } });
    const challenge = await platformAuth.login(email, 'Team@123456');
    const recovery = (await prisma.platform.platformRecoveryCode.count({ where: { adminId: admin.id, usedAt: null } })) > 0;
    expect(recovery).toBe(true);
    // Signed in with the phone's next unused code, or skip if this window's codes are spent.
    const session = await nextCode(email)
      .then((code) => platformAuth.verifyMfa(challenge.ticket, code))
      .catch(() => null);
    expect(await codeOf(platform.resetMfa(me, me.id))).toBe('own_account');
    const reset = await platform.resetMfa(me, admin.id);
    expect(reset.mfa).toBe(false);
    if (session) expect(await codeOf(platformAuth.refresh(session.refreshToken))).toBe('session_expired');
    expect(await prisma.platform.platformRecoveryCode.count({ where: { adminId: admin.id } })).toBe(0);
    expect((await platformAuth.login(email, 'Team@123456')).step).toBe('enroll');
  });
});

describe('Colleges', () => {
  it('lists colleges with counts only, no college data', async () => {
    const rows = await platform.colleges({});
    const sample = rows.find((r) => r.id === sampleId)!;
    expect(sample).toMatchObject({ subdomain: 'sample', status: 'active', plan: 'trial' });
    expect(sample.users).toBeGreaterThan(5);
    expect(sample.activeUsers).toBeGreaterThan(0); // The college admin signed in above.
    expect(Object.keys(sample).sort()).toEqual(
      ['activeUsers', 'createdAt', 'evidence', 'id', 'lastActivityAt', 'name', 'plan', 'registerRecords', 'state', 'status', 'storageBytes', 'subdomain', 'type', 'users'].sort(),
    );
    expect(await platform.colleges({ search: 'no such college' })).toEqual([]);
  });

  it('shows who to contact and which frameworks the college uses', async () => {
    const detail = await platform.college(sampleId);
    expect(detail.contacts.map((c) => [c.name, c.role])).toEqual(
      expect.arrayContaining([
        ['Sample College Admin', 'College admin'],
        ['Sample Principal', 'Principal / Dean'],
      ]),
    );
    expect(detail.contacts.some((c) => c.name === 'Sample Faculty')).toBe(false);
    expect(detail.frameworks.map((f) => f.code)).toEqual(expect.arrayContaining(['NIRF_ENGINEERING', 'NBA_ENGG_TIER2']));
  });

  it('sets up a college and invites its first college admin', async () => {
    const input = createCollegeSchema.parse({ name: 'Second Sample College', type: 'autonomous', state: 'Telangana', subdomain: 'Second', adminName: 'Second Admin', adminEmail: 'admin@second-college.example' });
    const created = await platform.createCollege(me, input);
    expect(created).toMatchObject({ subdomain: 'second', type: 'autonomous', plan: 'trial', status: 'active', users: 1 });
    expect(created.contacts).toEqual([{ name: 'Second Admin', email: 'admin@second-college.example', mobile: null, role: 'College admin', status: 'invited' }]);
    await settle();
    const token = tokenIn(collegeMail, 'admin@second-college.example');
    const session = await collegeAuth.setPassword('second', token, 'Second@12345');
    expect(session.session.user.college.subdomain).toBe('second');

    expect(await codeOf(platform.createCollege(me, { ...input, adminEmail: 'x@second-college.example' }))).toBe('subdomain_taken');
    expect(createCollegeSchema.safeParse({ ...input, subdomain: 'admin' }).success).toBe(false);

    const log = await prisma.forTenant(created.id, (db) => db.auditLog.findFirstOrThrow({ where: { collegeId: created.id, action: 'platform_create' } }));
    expect(log.userId).toBeNull();
    expect(created.history.map((h) => h.action)).toEqual(['college_create']);
  });

  it('suspends a college: no sign-in or refresh until reactivated', async () => {
    const before = await collegeAuth.loginWithPassword('sample', 'principal@sample-college.example', SAMPLE_PASSWORD);
    expect(await codeOf(platform.setStatus(me, sampleId, { status: 'suspended', reason: 'Trial ended' }))).toBe('no_error');
    expect(await codeOf(collegeAuth.loginWithPassword('sample', 'principal@sample-college.example', SAMPLE_PASSWORD))).toBe('college_suspended');
    expect(await codeOf(collegeAuth.refresh('sample', before.refreshToken))).toBe('college_suspended');

    const detail = await platform.setStatus(me, sampleId, { status: 'active', reason: 'Subscription paid' });
    expect(detail.status).toBe('active');
    // Old sessions do not come back.
    expect(await codeOf(collegeAuth.refresh('sample', before.refreshToken))).toBe('session_expired');
    expect(await codeOf(collegeAuth.loginWithPassword('sample', 'principal@sample-college.example', SAMPLE_PASSWORD))).toBe('no_error');

    const actions = await prisma.forTenant(sampleId, (db) => db.auditLog.findMany({ where: { collegeId: sampleId, action: { startsWith: 'platform_' } }, orderBy: { at: 'asc' } }));
    expect(actions.map((a) => a.action)).toEqual(['platform_suspend', 'platform_reactivate']);
    expect(actions[0]!.after).toMatchObject({ by: 'YuCampus support', status: 'suspended', reason: 'Trial ended' });
    expect(detail.history.map((h) => h.action).slice(0, 2)).toEqual(['college_reactivate', 'college_suspend']);
  });

  it('changes the plan, and refuses an unknown college', async () => {
    expect((await platform.setPlan(me, sampleId, { plan: 'standard' })).plan).toBe('standard');
    expect(await codeOf(platform.college('00000000-0000-4000-8000-000000000000'))).toBe('not_found');
  });
});

describe('Rules (read only)', () => {
  it('lists frameworks with how many colleges use them, registers and rule files with their checked status', async () => {
    const rules = await platform.rules();
    expect(rules.frameworks.find((f) => f.code === 'NIRF_ENGINEERING')!.colleges).toBe(1);
    expect(rules.registers.some((r) => r.code === 'FACULTY')).toBe(true);
    const aishe = rules.files.find((f) => f.file === 'aishe/survey.json')!;
    expect(aishe).toMatchObject({ area: 'AISHE', version: '1', verified: false });
    expect(rules.files.map((f) => f.file)).toEqual(expect.arrayContaining(['nba/sar.json', 'nirf/parameters.json', 'surveys/templates.json']));
  });
});

describe('Team', () => {
  it('invites a team member, who chooses a password; disabling them ends access at once', async () => {
    const invited = await platform.invite(me, { name: 'Second Team Member', email: 'second@yucampus.example' });
    expect(invited.status).toBe('invited');
    await settle();
    const token = tokenIn(teamMail, 'second@yucampus.example');
    expect((await platformAuth.describeLink(token)).name).toBe('Second Team Member');
    const challenge = await platformAuth.setPassword(token, 'Team@123456');
    expect(await codeOf(platformAuth.setPassword(token, 'Team@123456'))).toBe('link_expired');
    phones.set('second@yucampus.example', challenge.enroll!.secret);
    const session = await platformAuth.verifyMfa(challenge.ticket, await nextCode('second@yucampus.example'));
    expect(session.session.admin.status).toBe('active');
    expect(await guardAllows(session.session.accessToken)).toBe(true);

    await platform.setAdminEnabled(me, invited.id, false);
    expect(await guardAllows(session.session.accessToken)).toBe(false);
    expect(await codeOf(platformAuth.refresh(session.refreshToken))).toBe('session_expired');
    expect(await codeOf(platformAuth.login('second@yucampus.example', 'Team@123456'))).toBe('invalid_credentials');
    expect(await codeOf(platform.setAdminEnabled(me, me.id, false))).toBe('own_account');
    expect(await codeOf(platform.invite(me, { name: 'Again', email: 'second@yucampus.example' }))).toBe('email_taken');
  });

  it('keeps every platform action in the platform audit log', async () => {
    const actions = (await platform.audit()).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['sign_in', 'college_create', 'college_suspend', 'college_reactivate', 'college_plan', 'admin_invite', 'admin_disable', 'password_chosen', 'mfa_enrolled', 'recovery_code_used', 'admin_reset_mfa']));
    const created = (await platform.audit()).find((e) => e.action === 'college_create')!;
    expect(created).toMatchObject({ admin: { name: SAMPLE_PLATFORM_ADMIN.name }, college: { name: 'Second Sample College' }, actionLabel: 'Set up a college' });
  });
});
