// Sign-in rules, run against the real migrations in an in-process Postgres with row-level security on.
// All people and numbers here are dummy sample data.
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@yucampus/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { IS_PUBLIC, REQUIRED_ACCESS } from '../src/auth/decorators.js';
import { AuthGuard, PermissionsGuard } from '../src/auth/guards.js';
import { OtpSender } from '../src/auth/otp-sender.js';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';
import { TokensService } from '../src/auth/tokens.service.js';
import { AppConfig } from '../src/config.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SAMPLE_PASSWORD, seed } from '../src/prisma/seed-data.js';
import { linksFor } from './notifications-for.js';

const OTHER_PASSWORD = 'Other@12345';

class RecordingOtpSender extends OtpSender {
  sent: { mobile: string; code: string }[] = [];
  async send(mobile: string, code: string) {
    this.sent.push({ mobile, code });
  }
  lastCodeFor(mobile: string) {
    return this.sent.findLast((message) => message.mobile === mobile)?.code;
  }
}

const config = new AppConfig();
const sender = new RecordingOtpSender();
const tokens = new TokensService(config);
let database: Database;
let prisma: PrismaService;
let auth: AuthService;

/** The stable error code of a rejected call, e.g. "invalid_credentials". */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof HttpException) return (error.getResponse() as { code: string }).code;
    throw error;
  }
  return 'no_error';
}

beforeAll(async () => {
  database = await openLocalDatabase({
    setup: async (owner) => {
      await seed(owner);
      const other = await owner.college.create({
        data: { name: 'Other Sample College', type: 'autonomous', subdomain: 'other', state: 'Andhra Pradesh' },
      });
      const user = await owner.user.create({
        data: {
          collegeId: other.id,
          name: 'Other College Admin',
          email: 'admin@other-college.example',
          mobile: '9000000099',
          passwordHash: await hashPassword(OTHER_PASSWORD),
          status: 'invited',
        },
      });
      await owner.userRole.create({ data: { collegeId: other.id, userId: user.id, role: 'college_admin' } });
    },
  });
  prisma = new PrismaService(database);
  auth = new AuthService(prisma, tokens, sender, config, new PermissionsService(prisma), linksFor(prisma, config).links);
}, 120_000);

afterAll(() => database.close());

describe('passwords', () => {
  it('verifies the right password only, and never stores it in plain text', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).not.toContain('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
    expect(await verifyPassword('correct horse', 'not-a-hash')).toBe(false);
  });
});

describe('email and password sign-in', () => {
  it('signs in and returns the person, their roles and their college', async () => {
    const { session, refreshToken } = await auth.loginWithPassword('sample', 'hod.cse@sample-college.example', SAMPLE_PASSWORD);
    expect(session.user.name).toBe('Sample HOD (CSE)');
    expect(session.user.college.subdomain).toBe('sample');
    expect(session.user.roles.map((assignment) => assignment.role).sort()).toEqual(['faculty', 'hod']);
    expect(session.user.roles.every((assignment) => assignment.departmentId)).toBe(true);
    expect(refreshToken.length).toBeGreaterThan(20);

    const fromToken = await tokens.verifyAccessToken(session.accessToken);
    expect(fromToken?.id).toBe(session.user.id);
    expect(fromToken?.collegeId).toBe(session.user.college.id);
    expect(fromToken?.roles).toEqual(session.user.roles);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    expect(await codeOf(auth.loginWithPassword('sample', 'iqac@sample-college.example', 'wrong'))).toBe('invalid_credentials');
    expect(await codeOf(auth.loginWithPassword('sample', 'nobody@sample-college.example', 'wrong'))).toBe('invalid_credentials');
  });

  it('does not let credentials of one college work on another', async () => {
    expect(await codeOf(auth.loginWithPassword('other', 'iqac@sample-college.example', SAMPLE_PASSWORD))).toBe('invalid_credentials');
    expect(await codeOf(auth.loginWithPassword('sample', 'admin@other-college.example', OTHER_PASSWORD))).toBe('invalid_credentials');
  });

  it('rejects an unknown or malformed college', async () => {
    expect(await codeOf(auth.loginWithPassword('nope', 'iqac@sample-college.example', SAMPLE_PASSWORD))).toBe('college_not_found');
    expect(await codeOf(auth.loginWithPassword("x' OR 1=1", 'iqac@sample-college.example', SAMPLE_PASSWORD))).toBe('college_not_found');
  });

  it('marks an invited person active the first time they sign in', async () => {
    const { session } = await auth.loginWithPassword('other', 'admin@other-college.example', OTHER_PASSWORD);
    expect(session.user.status).toBe('active');
  });

  it('locks the account after repeated wrong passwords, even for the right one', async () => {
    const email = 'office@sample-college.example';
    for (let attempt = 1; attempt < config.loginMaxFailures; attempt++) {
      expect(await codeOf(auth.loginWithPassword('sample', email, 'wrong'))).toBe('invalid_credentials');
    }
    expect(await codeOf(auth.loginWithPassword('sample', email, 'wrong'))).toBe('account_locked');
    expect(await codeOf(auth.loginWithPassword('sample', email, SAMPLE_PASSWORD))).toBe('account_locked');
  });

  it('forgets earlier wrong passwords after a successful sign-in', async () => {
    const email = 'nirf@sample-college.example';
    for (let attempt = 1; attempt < config.loginMaxFailures; attempt++) {
      await codeOf(auth.loginWithPassword('sample', email, 'wrong'));
    }
    await auth.loginWithPassword('sample', email, SAMPLE_PASSWORD);
    expect(await codeOf(auth.loginWithPassword('sample', email, 'wrong'))).toBe('invalid_credentials');
  });
});

describe('mobile OTP sign-in', () => {
  it('signs in with the code that was sent, once only', async () => {
    const mobile = '9000000007';
    await auth.requestOtp('sample', mobile);
    const code = sender.lastCodeFor(mobile)!;
    expect(code).toMatch(/^\d{6}$/);

    const { session } = await auth.verifyOtp('sample', mobile, code);
    expect(session.user.name).toBe('Sample Faculty');
    expect(await codeOf(auth.verifyOtp('sample', mobile, code))).toBe('invalid_otp');
  });

  it('sends nothing to an unknown number but answers the same way', async () => {
    const before = sender.sent.length;
    expect(await auth.requestOtp('sample', '9111111111')).toEqual({ sent: true, expiresIn: config.otpSeconds });
    expect(sender.sent.length).toBe(before);
    expect(await codeOf(auth.verifyOtp('sample', '9111111111', '123456'))).toBe('invalid_otp');
  });

  it('does not accept a code on a different college', async () => {
    const mobile = '9000000002';
    await auth.requestOtp('sample', mobile);
    const code = sender.lastCodeFor(mobile)!;
    expect(await codeOf(auth.verifyOtp('other', mobile, code))).toBe('invalid_otp');
    await auth.verifyOtp('sample', mobile, code);
  });

  it('stops accepting a code after too many wrong guesses', async () => {
    const mobile = '9000000005';
    await auth.requestOtp('sample', mobile);
    const code = sender.lastCodeFor(mobile)!;
    const wrong = code === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < config.otpMaxAttempts; attempt++) {
      expect(await codeOf(auth.verifyOtp('sample', mobile, wrong))).toBe('invalid_otp');
    }
    expect(await codeOf(auth.verifyOtp('sample', mobile, code))).toBe('invalid_otp');
  });

  it('does not accept an expired code', async () => {
    const mobile = '9000000006';
    config.otpSeconds = -1;
    try {
      await auth.requestOtp('sample', mobile);
    } finally {
      config.otpSeconds = new AppConfig().otpSeconds;
    }
    expect(await codeOf(auth.verifyOtp('sample', mobile, sender.lastCodeFor(mobile)!))).toBe('invalid_otp');
  });

  it('limits how many codes one number can request', async () => {
    const mobile = '9000000008';
    for (let request = 0; request < config.otpMaxRequests; request++) {
      await auth.requestOtp('sample', mobile);
    }
    expect(await codeOf(auth.requestOtp('sample', mobile))).toBe('too_many_otp_requests');
  });
});

describe('sessions', () => {
  const signIn = () => auth.loginWithPassword('sample', 'principal@sample-college.example', SAMPLE_PASSWORD);

  it('swaps a refresh token for a new one', async () => {
    const first = await signIn();
    const second = await auth.refresh('sample', first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.session.user.id).toBe(first.session.user.id);
    await auth.refresh('sample', second.refreshToken);
  });

  it('accepts a just-replaced token for a moment, so two tabs refreshing together both work', async () => {
    const first = await signIn();
    await auth.refresh('sample', first.refreshToken);
    await auth.refresh('sample', first.refreshToken);
  });

  it('ends every session when an old refresh token comes back', async () => {
    config.refreshReuseGraceSeconds = -1;
    try {
      const first = await signIn();
      const second = await auth.refresh('sample', first.refreshToken);
      expect(await codeOf(auth.refresh('sample', first.refreshToken))).toBe('session_expired');
      expect(await codeOf(auth.refresh('sample', second.refreshToken))).toBe('session_expired');
    } finally {
      config.refreshReuseGraceSeconds = new AppConfig().refreshReuseGraceSeconds;
    }
  });

  it('does not accept a refresh token on a different college, or a made-up one', async () => {
    const { refreshToken } = await signIn();
    expect(await codeOf(auth.refresh('other', refreshToken))).toBe('session_expired');
    expect(await codeOf(auth.refresh('sample', 'made-up-token'))).toBe('session_expired');
    expect(await codeOf(auth.refresh('sample', undefined))).toBe('session_expired');
  });

  it('cannot refresh after signing out', async () => {
    const { refreshToken } = await signIn();
    await auth.logout('sample', refreshToken);
    config.refreshReuseGraceSeconds = -1;
    try {
      expect(await codeOf(auth.refresh('sample', refreshToken))).toBe('session_expired');
    } finally {
      config.refreshReuseGraceSeconds = new AppConfig().refreshReuseGraceSeconds;
    }
  });

  it('returns the signed-in person from /me and records the sign-in in the audit log', async () => {
    const { session } = await signIn();
    const user = (await tokens.verifyAccessToken(session.accessToken))!;
    const me = await auth.me(user);
    expect(me.email).toBe('principal@sample-college.example');
    expect(me.permissions.some((grant) => grant.permission === 'users_setup.manage' && grant.scope === 'college')).toBe(true);

    const entries = await prisma.forTenant(user.collegeId, (db) =>
      db.auditLog.count({ where: { userId: user.id, action: 'sign_in' } }),
    );
    expect(entries).toBeGreaterThan(0);
  });
});

describe('access tokens', () => {
  it('rejects a tampered token, a token signed with another secret, and an expired one', async () => {
    const user = { id: 'u1', collegeId: 'c1', roles: [{ role: 'iqac' as Role, departmentId: null }] };
    const token = await tokens.signAccessToken(user);
    expect(await tokens.verifyAccessToken(token)).toEqual(user);
    expect(await tokens.verifyAccessToken(`${token.slice(0, -2)}xx`)).toBeNull();
    expect(await tokens.verifyAccessToken('not.a.token')).toBeNull();

    const elsewhere = new TokensService(Object.assign(new AppConfig(), { jwtSecret: new TextEncoder().encode('another-secret') }));
    expect(await tokens.verifyAccessToken(await elsewhere.signAccessToken(user))).toBeNull();

    const expired = new TokensService(Object.assign(new AppConfig(), { accessTokenSeconds: -10 }));
    expect(await tokens.verifyAccessToken(await expired.signAccessToken(user))).toBeNull();
  });
});

describe('guards', () => {
  const reflector = new Reflector();
  const authGuard = new AuthGuard(reflector, tokens);
  // No database needed: an unknown college simply has no adjustments, so the templates apply.
  const stubPermissions = { grantsFor: async (_c: string, roles: { role: Role; departmentId: string | null }[]) => (await import('@yucampus/types')).effectiveGrants(roles, []) } as unknown as PermissionsService;
  const rolesGuard = new PermissionsGuard(reflector, stubPermissions);

  function contextFor(metadata: Record<string, unknown>, request: object): ExecutionContext {
    const handler = () => undefined;
    for (const [key, value] of Object.entries(metadata)) Reflect.defineMetadata(key, value, handler);
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  const withRoles = (...roles: Role[]) => ({ user: { id: 'u', collegeId: 'c', roles: roles.map((role) => ({ role, departmentId: null })) } });

  it('refuses a request without a valid token unless the route is public', async () => {
    expect(await codeOf(authGuard.canActivate(contextFor({}, { headers: {} })))).toBe('unauthenticated');
    expect(await codeOf(authGuard.canActivate(contextFor({}, { headers: { authorization: 'Bearer junk' } })))).toBe('unauthenticated');
    expect(await authGuard.canActivate(contextFor({ [IS_PUBLIC]: true }, { headers: {} }))).toBe(true);
  });

  it('attaches the user from a valid token', async () => {
    const token = await tokens.signAccessToken({ id: 'u1', collegeId: 'c1', roles: [] });
    const request: { headers: object; user?: { id: string; collegeId: string } } = { headers: { authorization: `Bearer ${token}` } };
    expect(await authGuard.canActivate(contextFor({}, request))).toBe(true);
    expect(request.user).toMatchObject({ id: 'u1', collegeId: 'c1' });
  });

  it('lets through only people whose permissions match the route', async () => {
    const collegeWide = { [REQUIRED_ACCESS]: [{ permission: 'users_setup.manage', scopes: ['college'] }] };
    expect(await rolesGuard.canActivate(contextFor(collegeWide, withRoles('college_admin')))).toBe(true);
    expect(await rolesGuard.canActivate(contextFor(collegeWide, withRoles('faculty', 'principal')))).toBe(true);
    expect(await rolesGuard.canActivate(contextFor(collegeWide, withRoles('super_admin')))).toBe(true);
    expect(await codeOf(rolesGuard.canActivate(contextFor(collegeWide, withRoles('faculty', 'iqac'))))).toBe('forbidden');
    expect(await codeOf(rolesGuard.canActivate(contextFor(collegeWide, withRoles())))).toBe('forbidden');
    expect(await rolesGuard.canActivate(contextFor({}, withRoles('faculty')))).toBe(true);
  });

  it('attaches the person’s permissions to the request', async () => {
    const request = withRoles('iqac') as { user: { grants?: unknown[] } };
    await rolesGuard.canActivate(contextFor({}, request));
    expect(request.user.grants?.length).toBeGreaterThan(0);
  });
});
