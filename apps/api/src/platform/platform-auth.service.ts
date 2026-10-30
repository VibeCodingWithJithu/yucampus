import { createHash, randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { PlatformAdminView, PlatformChallenge, PlatformSession } from '@yucampus/types';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { TokensService } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { AppConfig } from '../config.js';
import { Jobs } from '../jobs/jobs.js';
import { EmailSender } from '../mail/email-sender.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';
import type { PlatformActor } from './platform-guard.js';
import { SecretBox, newRecoveryCodes, newTotpSecret, normaliseRecoveryCode, otpauthUrl, verifyTotp } from './totp.js';

export interface StartedPlatformSession {
  session: PlatformSession;
  refreshToken: string;
}

type LinkPurpose = 'invite' | 'reset';
const LINK_LIFETIME_MS: Record<LinkPurpose, number> = { invite: 3 * 24 * 60 * 60 * 1000, reset: 60 * 60 * 1000 };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const wrongPassword = () => apiError(401, 'invalid_credentials', 'That email or password is not right.');
const signedOut = () => apiError(401, 'session_expired', 'Please sign in again.');
const badLink = () => apiError(410, 'link_expired', 'This link has expired or was already used. Ask a team member for a new one.');

const ADMIN_SELECT = { id: true, email: true, name: true, status: true, totpConfirmedAt: true, lastSignInAt: true, createdAt: true } as const;
const wrongCode = () => apiError(401, 'invalid_code', 'That code is not right. Check the time on your phone, or use a recovery code.');
const ticketExpired = () => apiError(401, 'ticket_expired', 'That took too long. Please sign in again.');

export function adminView(admin: {
  id: string;
  email: string;
  name: string;
  status: string;
  totpConfirmedAt: Date | null;
  lastSignInAt: Date | null;
  createdAt: Date;
}): PlatformAdminView {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    status: admin.status as PlatformAdminView['status'],
    mfa: admin.totpConfirmedAt !== null,
    lastSignInAt: admin.lastSignInAt?.toISOString() ?? null,
    createdAt: admin.createdAt.toISOString(),
  };
}

/**
 * Sign-in for the YuCampus team (docs/ARCHITECTURE.md "Platform panel"). Mirrors college sign-in: one message for
 * unknown email and wrong password, lock after repeated failures, rotating refresh tokens, links stored as hashes.
 * There is no public "forgot password": another team member sends a reset link.
 */
@Injectable()
export class PlatformAuthService implements OnModuleInit {
  private decoyHash?: Promise<string>;
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly config: AppConfig,
    private readonly jobs: Jobs,
    private readonly email: EmailSender,
  ) {
    this.box = new SecretBox(config.totpKey ?? config.jwtSecret);
  }

  onModuleInit() {
    this.jobs.register('platform.link', async (data) => {
      await this.sendLink(String(data.adminId), data.purpose === 'reset' ? 'reset' : 'invite');
    });
  }

  /** Step one: the password. Gives a sign-in ticket for the authenticator step, never a session. */
  async login(email: string, password: string): Promise<PlatformChallenge> {
    const admin = await this.prisma.platform.platformAdmin.findUnique({ where: { email } });
    if (!admin?.passwordHash || admin.status !== 'active') {
      this.decoyHash ??= hashPassword('not-a-real-password');
      await verifyPassword(password, await this.decoyHash);
      throw wrongPassword();
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw apiError(423, 'account_locked', `Too many wrong passwords. Try again in ${this.config.loginLockMinutes} minutes.`);
    }
    if (!(await verifyPassword(password, admin.passwordHash))) {
      const failures = admin.failedLogins + 1;
      const lock = failures >= this.config.loginMaxFailures;
      await this.prisma.platform.platformAdmin.update({
        where: { id: admin.id },
        data: { failedLogins: lock ? 0 : failures, lockedUntil: lock ? new Date(Date.now() + this.config.loginLockMinutes * 60_000) : null },
      });
      if (lock) throw apiError(423, 'account_locked', `Too many wrong passwords. Try again in ${this.config.loginLockMinutes} minutes.`);
      throw wrongPassword();
    }
    return this.challenge(admin.id);
  }

  /** The authenticator step that follows a correct password. Someone without an authenticator sets one up now. */
  private async challenge(adminId: string): Promise<PlatformChallenge> {
    const admin = await this.prisma.platform.platformAdmin.findUniqueOrThrow({ where: { id: adminId } });
    if (admin.totpConfirmedAt && admin.totpSecret) return { step: 'code', ticket: await this.tokens.signMfaTicket(adminId, false) };
    // Keep an unconfirmed secret across attempts, so a QR code scanned a minute ago still works.
    let secret = admin.totpSecret ? this.box.open(admin.totpSecret) : null;
    if (!secret) {
      secret = newTotpSecret();
      await this.prisma.platform.platformAdmin.update({ where: { id: adminId }, data: { totpSecret: this.box.seal(secret), totpConfirmedAt: null, totpLastStep: null } });
    }
    return { step: 'enroll', ticket: await this.tokens.signMfaTicket(adminId, true), enroll: { secret, otpauthUrl: otpauthUrl(secret, admin.email) } };
  }

  /**
   * Step two: a code from the authenticator app (or a recovery code) and the ticket. Gives the session. Setting up
   * the app also gives the recovery codes, once. Wrong codes count towards the same lock as wrong passwords.
   */
  async verifyMfa(ticket: string, code: string): Promise<StartedPlatformSession> {
    const claim = await this.tokens.verifyMfaTicket(ticket);
    if (!claim) throw ticketExpired();
    const admin = await this.prisma.platform.platformAdmin.findFirst({ where: { id: claim.adminId, status: 'active' } });
    if (!admin?.totpSecret || !admin.passwordHash) throw ticketExpired();
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw apiError(423, 'account_locked', `Too many wrong attempts. Try again in ${this.config.loginLockMinutes} minutes.`);
    }
    const enrolling = admin.totpConfirmedAt === null;
    // An enrolment ticket only sets up the app; a sign-in ticket only signs in.
    if (claim.enroll !== enrolling) throw ticketExpired();

    let step: number | null = null;
    let recoveryId: string | null = null;
    if (/^\d{6}$/.test(code)) {
      step = verifyTotp(this.box.open(admin.totpSecret), code, admin.totpLastStep);
    } else if (!enrolling) {
      const hash = hashToken(normaliseRecoveryCode(code));
      recoveryId = (await this.prisma.platform.platformRecoveryCode.findFirst({ where: { adminId: admin.id, codeHash: hash, usedAt: null } }))?.id ?? null;
    }
    if (step === null && recoveryId === null) {
      const failures = admin.failedLogins + 1;
      const lock = failures >= this.config.loginMaxFailures;
      await this.prisma.platform.platformAdmin.update({
        where: { id: admin.id },
        data: { failedLogins: lock ? 0 : failures, lockedUntil: lock ? new Date(Date.now() + this.config.loginLockMinutes * 60_000) : null },
      });
      if (lock) throw apiError(423, 'account_locked', `Too many wrong attempts. Try again in ${this.config.loginLockMinutes} minutes.`);
      throw wrongCode();
    }

    const recoveryCodes = enrolling ? newRecoveryCodes() : undefined;
    const started = await this.prisma.platformTransaction(async (db) => {
      if (step !== null) {
        // Conditional, so two requests with the same code cannot both pass.
        const used = await db.platformAdmin.updateMany({
          where: { id: admin.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
          data: { totpLastStep: step, ...(enrolling ? { totpConfirmedAt: new Date() } : {}) },
        });
        if (used.count !== 1) throw wrongCode();
      }
      if (recoveryId) {
        const used = await db.platformRecoveryCode.updateMany({ where: { id: recoveryId, usedAt: null }, data: { usedAt: new Date() } });
        if (used.count !== 1) throw wrongCode();
        await db.platformAuditLog.create({ data: { adminId: admin.id, action: 'recovery_code_used' } });
      }
      if (recoveryCodes) {
        await db.platformRecoveryCode.deleteMany({ where: { adminId: admin.id } });
        await db.platformRecoveryCode.createMany({ data: recoveryCodes.map((c) => ({ adminId: admin.id, codeHash: hashToken(normaliseRecoveryCode(c)) })) });
        await db.platformAuditLog.create({ data: { adminId: admin.id, action: 'mfa_enrolled' } });
      }
      return this.start(db, admin.id);
    });
    return recoveryCodes ? { ...started, session: { ...started.session, recoveryCodes } } : started;
  }

  async refresh(refreshToken: string | undefined): Promise<StartedPlatformSession> {
    if (!refreshToken) throw signedOut();
    const now = new Date();
    const started = await this.prisma.platformTransaction(async (db) => {
      const row = await db.platformRefreshToken.findUnique({ where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) } });
      if (!row || row.expiresAt <= now) return null;
      if (row.revokedAt) {
        if (now.getTime() > row.revokedAt.getTime() + this.config.refreshReuseGraceSeconds * 1000) {
          // An old token came back: it may have been stolen. End every session of this team member.
          await db.platformRefreshToken.deleteMany({ where: { adminId: row.adminId } });
          return null;
        }
      } else {
        await db.platformRefreshToken.update({ where: { id: row.id }, data: { revokedAt: now } });
      }
      return this.issue(db, row.adminId);
    });
    if (!started) throw signedOut();
    return started;
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.platform.platformRefreshToken.deleteMany({ where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) } });
  }

  async me(actor: PlatformActor): Promise<PlatformAdminView> {
    return adminView(await this.prisma.platform.platformAdmin.findUniqueOrThrow({ where: { id: actor.id }, select: ADMIN_SELECT }));
  }

  async describeLink(token: string): Promise<{ purpose: LinkPurpose; name: string; email: string }> {
    const link = await this.prisma.platform.platformPasswordLink.findFirst({
      where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: new Date() }, admin: { status: { not: 'disabled' } } },
      select: { purpose: true, admin: { select: { name: true, email: true } } },
    });
    if (!link) throw badLink();
    return { purpose: link.purpose as LinkPurpose, name: link.admin.name, email: link.admin.email };
  }

  /** Chooses a password from a link and ends every other session. Signing in still needs the authenticator step. */
  async setPassword(token: string, password: string): Promise<PlatformChallenge> {
    await this.describeLink(token);
    const passwordHash = await hashPassword(password);
    const adminId = await this.prisma.platformTransaction(async (db) => {
      const link = await db.platformPasswordLink.findFirst({ where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: new Date() } } });
      if (!link) throw badLink();
      const marked = await db.platformPasswordLink.updateMany({ where: { id: link.id, usedAt: null }, data: { usedAt: new Date() } });
      if (marked.count !== 1) throw badLink();
      await db.platformAdmin.update({ where: { id: link.adminId }, data: { passwordHash, status: 'active', failedLogins: 0, lockedUntil: null } });
      await db.platformRefreshToken.deleteMany({ where: { adminId: link.adminId } });
      await db.platformAuditLog.create({ data: { adminId: link.adminId, action: 'password_chosen', detail: { purpose: link.purpose } } });
      return link.adminId;
    });
    return this.challenge(adminId);
  }

  /** Queues an invite or reset email. The job carries the id only; the link is made when the email is sent. */
  async sendLinkLater(adminId: string, purpose: LinkPurpose) {
    await this.jobs.enqueue('platform.link', { adminId, purpose });
  }

  /** Makes a new link (replacing unused ones) and emails it. Returns the link for the command-line tool. */
  async sendLink(adminId: string, purpose: LinkPurpose, deliver = true): Promise<string | null> {
    const made = await this.prisma.platformTransaction(async (db) => {
      const admin = await db.platformAdmin.findFirst({ where: { id: adminId, status: { not: 'disabled' } } });
      if (!admin) return null;
      await db.platformPasswordLink.updateMany({ where: { adminId, usedAt: null }, data: { usedAt: new Date() } });
      const token = randomBytes(32).toString('base64url');
      await db.platformPasswordLink.create({ data: { adminId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + LINK_LIFETIME_MS[purpose]) } });
      return { admin, url: `${this.config.platformUrl()}/set-password?token=${token}` };
    });
    if (!made) return null;
    if (deliver) {
      await this.email.send({
        to: made.admin.email,
        subject: purpose === 'invite' ? 'You have been added to the YuCampus team panel' : 'Choose a new password for the YuCampus team panel',
        text:
          purpose === 'invite'
            ? `Hello ${made.admin.name},\n\nYou have been added to the YuCampus platform panel. Choose a password to sign in. The link works for 3 days and only once.`
            : `Hello ${made.admin.name},\n\nA team member sent you a link to choose a new password for the YuCampus platform panel. It works for 60 minutes and only once.`,
        action: { label: 'Choose a password', url: made.url },
      });
    }
    return made.url;
  }

  private async start(db: TenantClient, adminId: string): Promise<StartedPlatformSession> {
    await db.platformAdmin.update({ where: { id: adminId }, data: { lastSignInAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await db.platformAuditLog.create({ data: { adminId, action: 'sign_in' } });
    const started = await this.issue(db, adminId);
    if (!started) throw signedOut();
    return started;
  }

  private async issue(db: TenantClient, adminId: string): Promise<StartedPlatformSession | null> {
    const admin = await db.platformAdmin.findFirst({ where: { id: adminId, status: 'active' }, select: ADMIN_SELECT });
    if (!admin) return null;
    const refresh = this.tokens.newRefreshToken();
    await db.platformRefreshToken.create({
      data: { adminId, tokenHash: refresh.hash, expiresAt: new Date(Date.now() + this.config.platformRefreshHours * 3_600_000) },
    });
    return {
      session: { accessToken: await this.tokens.signPlatformToken(adminId), expiresIn: this.config.accessTokenSeconds, admin: adminView(admin) },
      refreshToken: refresh.token,
    };
  }
}
