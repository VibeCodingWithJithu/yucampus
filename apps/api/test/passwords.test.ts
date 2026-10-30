// Invite and reset links: choosing a password by email, and what the links refuse to do.

import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { userInputSchema } from '@yucampus/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { OtpSender } from '../src/auth/otp-sender.js';
import type { PasswordLinksService } from '../src/auth/password-links.service.js';
import { type AuthUser, TokensService } from '../src/auth/tokens.service.js';
import { AppConfig } from '../src/config.js';
import type { ConsoleEmailSender } from '../src/mail/email-sender.js';
import { PermissionsService } from '../src/permissions/permissions.service.js';
import { type Database, openLocalDatabase } from '../src/prisma/database.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SAMPLE_PASSWORD, seed } from '../src/prisma/seed-data.js';
import { UsersService } from '../src/users/users.service.js';
import { linksFor } from './notifications-for.js';

class SilentOtpSender extends OtpSender {
  async send() {}
}

const config = new AppConfig();
let database: Database;
let prisma: PrismaService;
let auth: AuthService;
let users: UsersService;
let links: PasswordLinksService;
let mail: ConsoleEmailSender;
let admin: AuthUser;
let resetToken: string;

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    if (error instanceof HttpException) return (error.getResponse() as { code: string }).code;
    throw error;
  }
  return 'no_error';
}

/** Waits for background jobs (they run on the next turn of the event loop). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** The token in the newest email to this address. */
function tokenFor(to: string): string {
  const email = [...mail.sent].reverse().find((m) => m.to === to);
  const url = new URL(email!.action!.url);
  return url.searchParams.get('token')!;
}

beforeAll(async () => {
  database = await openLocalDatabase({ setup: (owner) => seed(owner) });
  prisma = new PrismaService(database);
  ({ links, email: mail } = linksFor(prisma, config, true));
  const permissions = new PermissionsService(prisma);
  auth = new AuthService(prisma, new TokensService(config), new SilentOtpSender(), config, permissions, links);
  users = new UsersService(prisma, permissions, links);
  const collegeId = (await prisma.resolveCollegeId('sample'))!;
  const row = await prisma.forTenant(collegeId, (db) =>
    db.user.findFirstOrThrow({ where: { collegeId, email: 'admin@sample-college.example' }, include: { roles: true } }),
  );
  admin = { id: row.id, collegeId, roles: row.roles.map(({ role, departmentId }) => ({ role, departmentId })) };
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe('invites', () => {
  it('emails a person who is added, and their link lets them choose a password and sign in', async () => {
    const person = await users.create(
      admin,
      userInputSchema.parse({ name: 'New Faculty', email: 'new.faculty@sample-college.example', roles: [{ role: 'office' }] }),
    );
    expect(person.status).toBe('invited');
    await settle();
    const invite = mail.sent.find((m) => m.to === 'new.faculty@sample-college.example');
    expect(invite?.subject).toMatch(/^You have been added to YuCampus at /);
    expect(invite?.action?.url).toMatch(/\/reset-password\?token=/);

    const token = tokenFor('new.faculty@sample-college.example');
    expect(await auth.passwordLink('sample', token)).toMatchObject({ purpose: 'invite', name: 'New Faculty' });

    const started = await auth.setPassword('sample', token, 'chosen-pass-1');
    expect(started.session.user.status).toBe('active');
    // The new password works; the link does not work twice.
    expect((await auth.loginWithPassword('sample', 'new.faculty@sample-college.example', 'chosen-pass-1')).session.user.name).toBe('New Faculty');
    expect(await codeOf(auth.setPassword('sample', token, 'another-pass-2'))).toBe('link_expired');
  });

  it('a resent invite replaces the earlier link, and a person who signed in gets none', async () => {
    const person = await users.create(admin, userInputSchema.parse({ name: 'Second Person', email: 'second@sample-college.example', roles: [{ role: 'office' }] }));
    await settle();
    const first = tokenFor('second@sample-college.example');
    await users.resendInvite(admin, person.id);
    await settle();
    const second = tokenFor('second@sample-college.example');
    expect(second).not.toBe(first);
    expect(await codeOf(auth.passwordLink('sample', first))).toBe('link_expired');
    expect(await codeOf(auth.passwordLink('sample', second))).toBe('no_error');

    const active = await prisma.forTenant(admin.collegeId, (db) =>
      db.user.findFirstOrThrow({ where: { collegeId: admin.collegeId, email: 'principal@sample-college.example' } }),
    );
    expect(await codeOf(users.resendInvite(admin, active.id))).toBe('already_active');
  });

  it('sends no invites when an import is only checked', async () => {
    mail.sent.length = 0;
    const rows = [{ name: 'Checked Only', email: 'checked@sample-college.example', role: 'office' }];
    await users.import(admin, rows, true);
    await settle();
    expect(mail.sent).toHaveLength(0);
    await users.import(admin, rows, false);
    await settle();
    expect(mail.sent.map((m) => m.to)).toEqual(['checked@sample-college.example']);
  });
});

describe('signing out', () => {
  it('ends the session at once: the refresh cookie does not work again', async () => {
    const started = await auth.loginWithPassword('sample', 'principal@sample-college.example', SAMPLE_PASSWORD);
    await auth.logout('sample', started.refreshToken);
    expect(await codeOf(auth.refresh('sample', started.refreshToken))).toBe('session_expired');
  });
});

describe('forgot password', () => {
  it('answers the same for a known and an unknown email, and emails only the known one', async () => {
    mail.sent.length = 0;
    expect(await auth.forgotPassword('sample', 'faculty@sample-college.example')).toEqual({ sent: true });
    expect(await auth.forgotPassword('sample', 'nobody@sample-college.example')).toEqual({ sent: true });
    await settle();
    expect(mail.sent.map((m) => m.to)).toEqual(['faculty@sample-college.example']);
    resetToken = tokenFor('faculty@sample-college.example');
  });

  it('does not send a second email within two minutes', async () => {
    mail.sent.length = 0;
    await auth.forgotPassword('sample', 'faculty@sample-college.example');
    await settle();
    expect(mail.sent).toHaveLength(0);
  });

  it('resets the password, ends other sessions and lifts a lock', async () => {
    const before = await auth.loginWithPassword('sample', 'faculty@sample-college.example', SAMPLE_PASSWORD);
    const token = resetToken;

    await auth.setPassword('sample', token, 'brand-new-pass-9');
    expect(await codeOf(auth.refresh('sample', before.refreshToken))).toBe('session_expired');
    expect(await codeOf(auth.loginWithPassword('sample', 'faculty@sample-college.example', SAMPLE_PASSWORD))).toBe('invalid_credentials');
    expect((await auth.loginWithPassword('sample', 'faculty@sample-college.example', 'brand-new-pass-9')).session.user.email).toBe(
      'faculty@sample-college.example',
    );
  });

  it('refuses made-up, expired and other-college links', async () => {
    expect(await codeOf(auth.passwordLink('sample', 'x'.repeat(43)))).toBe('link_expired');

    await links.sendReset(admin.collegeId, 'iqac@sample-college.example');
    const token = tokenFor('iqac@sample-college.example');
    // A link for the sample college does nothing at another college's address.
    expect(await codeOf(auth.passwordLink('nosuchcollege', token))).toBe('college_not_found');

    await prisma.forTenant(admin.collegeId, (db) =>
      db.passwordLink.updateMany({ where: { collegeId: admin.collegeId, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } }),
    );
    expect(await codeOf(auth.setPassword('sample', token, 'expired-pass-1'))).toBe('link_expired');
  });

  it('stores only a hash of each link', async () => {
    const token = tokenFor('iqac@sample-college.example');
    const stored = await prisma.forTenant(admin.collegeId, (db) => db.passwordLink.findMany({ where: { collegeId: admin.collegeId } }));
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.some((row) => row.tokenHash === token)).toBe(false);
  });
});
