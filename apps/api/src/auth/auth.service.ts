import { Injectable } from '@nestjs/common';
import type { SessionResponse, SessionUser } from '@yucampus/types';
import { apiError } from '../common/api-error.js';
import { AppConfig } from '../config.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';
import { OtpSender } from './otp-sender.js';
import { PasswordLinksService } from './password-links.service.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { hashHandoff } from './sso.service.js';
import { type AuthUser, TokensService } from './tokens.service.js';

/** What a successful sign-in or refresh produces. The controller puts `refreshToken` in an httpOnly cookie. */
export interface StartedSession {
  session: SessionResponse;
  refreshToken: string;
}

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// One message for "no such user" and "wrong password/code", so sign-in never reveals who has an account.
const wrongPassword = () => apiError(401, 'invalid_credentials', 'That email or password is not right.');
const wrongOtp = () => apiError(401, 'invalid_otp', 'That code is wrong or has expired. Request a new one.');
const signedOut = () => apiError(401, 'session_expired', 'Please sign in again.');

@Injectable()
export class AuthService {
  /** Verified against when the email is unknown, so that case takes as long as a wrong password. */
  private decoyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly otpSender: OtpSender,
    private readonly config: AppConfig,
    private readonly permissions: PermissionsService,
    private readonly links: PasswordLinksService,
  ) {}

  async requestOtp(subdomain: string | undefined, mobile: string): Promise<{ sent: true; expiresIn: number }> {
    const collegeId = await this.collegeIdFor(subdomain);
    const now = Date.now();
    const code = this.tokens.newOtp();

    const outcome = await this.prisma.forTenant(collegeId, async (db) => {
      const windowStart = new Date(now - this.config.otpRequestWindowSeconds * 1000);
      const recent = await db.otpCode.count({ where: { collegeId, mobile, createdAt: { gt: windowStart } } });
      if (recent >= this.config.otpMaxRequests) return 'too_many' as const;

      // A row is stored for unknown numbers too, so the request limit behaves the same for everyone.
      await db.otpCode.create({
        data: {
          collegeId,
          mobile,
          codeHash: this.tokens.hashOtp(collegeId, mobile, code),
          expiresAt: new Date(now + this.config.otpSeconds * 1000),
        },
      });
      const user = await db.user.findFirst({ where: { collegeId, mobile }, select: { id: true } });
      if (!user) return null;
      return db.college.findUniqueOrThrow({ where: { id: collegeId }, select: { name: true } });
    });

    if (outcome === 'too_many') {
      throw apiError(429, 'too_many_otp_requests', 'Too many codes requested. Please wait 10 minutes and try again.');
    }
    if (outcome) await this.otpSender.send(mobile, code, outcome.name);
    return { sent: true, expiresIn: this.config.otpSeconds };
  }

  async verifyOtp(subdomain: string | undefined, mobile: string, code: string): Promise<StartedSession> {
    const collegeId = await this.collegeIdFor(subdomain);
    const now = new Date();

    // Failures are returned (not thrown) from inside the transaction, so the attempt counter is saved.
    const started = await this.prisma.forTenant(collegeId, async (db) => {
      const otp = await db.otpCode.findFirst({
        where: { collegeId, mobile, consumedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      });
      if (!otp || otp.attempts >= this.config.otpMaxAttempts) return null;
      if (!this.tokens.otpMatches(collegeId, mobile, code, otp.codeHash)) {
        await db.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
        return null;
      }
      await db.otpCode.update({ where: { id: otp.id }, data: { consumedAt: now } });
      const user = await db.user.findFirst({ where: { collegeId, mobile }, select: { id: true } });
      return user ? this.startSession(db, collegeId, user.id, 'otp') : null;
    });

    if (!started) throw wrongOtp();
    return started;
  }

  async loginWithPassword(subdomain: string | undefined, email: string, password: string): Promise<StartedSession> {
    const collegeId = await this.collegeIdFor(subdomain);

    const user = await this.prisma.forTenant(collegeId, (db) =>
      db.user.findFirst({
        where: { collegeId, email },
        select: { id: true, passwordHash: true, failedLogins: true, lockedUntil: true },
      }),
    );
    if (!user?.passwordHash) {
      this.decoyHash ??= hashPassword('not-a-real-password');
      await verifyPassword(password, await this.decoyHash);
      throw wrongPassword();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw this.locked();

    // Password hashing is slow on purpose, so it runs outside any database transaction.
    if (!(await verifyPassword(password, user.passwordHash))) {
      const failures = user.failedLogins + 1;
      const lock = failures >= this.config.loginMaxFailures;
      await this.prisma.forTenant(collegeId, (db) =>
        db.user.update({
          where: { id: user.id },
          data: {
            failedLogins: lock ? 0 : failures,
            lockedUntil: lock ? new Date(Date.now() + this.config.loginLockMinutes * 60_000) : null,
          },
        }),
      );
      throw lock ? this.locked() : wrongPassword();
    }

    return this.prisma.forTenant(collegeId, (db) => this.startSession(db, collegeId, user.id, 'password'));
  }

  /** Always answers the same way, so the form never reveals who has an account. The email goes out in the background. */
  async forgotPassword(subdomain: string | undefined, email: string): Promise<{ sent: true }> {
    const collegeId = await this.collegeIdFor(subdomain);
    await this.links.requestReset(collegeId, email);
    return { sent: true };
  }

  async passwordLink(subdomain: string | undefined, token: string) {
    return this.links.describe(await this.collegeIdFor(subdomain), token);
  }

  /**
   * Sets a password from an invite or reset link and signs the person in. Every other session of theirs ends,
   * and a lock from wrong passwords is lifted.
   */
  async setPassword(subdomain: string | undefined, token: string, password: string): Promise<StartedSession> {
    const collegeId = await this.collegeIdFor(subdomain);
    // Check the link first, so nobody can make the server hash passwords for a made-up link.
    await this.links.describe(collegeId, token);
    const passwordHash = await hashPassword(password);
    return this.prisma.forTenant(collegeId, async (db) => {
      const { userId, purpose } = await this.links.use(db, collegeId, token);
      await db.user.update({ where: { id: userId }, data: { passwordHash } });
      // Every session ends at once (deleted, so the reuse grace in refresh() does not apply).
      await db.refreshToken.deleteMany({ where: { collegeId, userId } });
      await db.auditLog.create({
        data: { collegeId, userId, entity: 'user', entityId: userId, action: purpose === 'invite' ? 'password_chosen' : 'password_reset' },
      });
      return this.startSession(db, collegeId, userId, 'password');
    });
  }

  /**
   * The last step of a Google or Microsoft sign-in, on the college's own address: swaps the one-time handoff code
   * for a session, so the refresh cookie belongs to this college's host.
   */
  async finishSso(subdomain: string | undefined, code: string): Promise<StartedSession> {
    const collegeId = await this.collegeIdFor(subdomain);
    const started = await this.prisma.forTenant(collegeId, async (db) => {
      const handoff = await db.ssoHandoff.findFirst({ where: { collegeId, codeHash: hashHandoff(code), usedAt: null, expiresAt: { gt: new Date() } } });
      if (!handoff) return null;
      const used = await db.ssoHandoff.updateMany({ where: { id: handoff.id, usedAt: null }, data: { usedAt: new Date() } });
      if (used.count !== 1) return null;
      return this.startSession(db, collegeId, handoff.userId, handoff.provider === 'microsoft' ? 'microsoft' : 'google');
    });
    if (!started) throw apiError(410, 'sso_expired', 'That sign-in took too long or was already used. Please try again.');
    return started;
  }

  /** Swaps a refresh token for a new one (rotation) and a fresh access token. */
  async refresh(subdomain: string | undefined, refreshToken: string | undefined): Promise<StartedSession> {
    if (!refreshToken) throw signedOut();
    const collegeId = await this.collegeIdFor(subdomain);
    const now = new Date();

    const started = await this.prisma.forTenant(collegeId, async (db) => {
      const row = await db.refreshToken.findUnique({ where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) } });
      if (!row || row.collegeId !== collegeId || row.expiresAt <= now) return null;

      if (row.revokedAt) {
        const graceEnds = row.revokedAt.getTime() + this.config.refreshReuseGraceSeconds * 1000;
        if (now.getTime() > graceEnds) {
          // An old token came back: it may have been stolen. End every session of this person.
          await db.refreshToken.updateMany({
            where: { collegeId, userId: row.userId, revokedAt: null },
            data: { revokedAt: now },
          });
          return null;
        }
      } else {
        await db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: now } });
      }
      return this.issueTokens(db, collegeId, row.userId);
    });

    if (!started) throw signedOut();
    return started;
  }

  async logout(subdomain: string | undefined, refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const collegeId = await this.collegeIdFor(subdomain);
    // Deleted, not marked revoked: the reuse grace in refresh() must not bring a signed-out session back.
    await this.prisma.forTenant(collegeId, (db) =>
      db.refreshToken.deleteMany({ where: { collegeId, tokenHash: this.tokens.hashRefreshToken(refreshToken) } }),
    );
  }

  async me(auth: AuthUser): Promise<SessionUser> {
    const user = await this.prisma.forTenant(auth.collegeId, (db) => this.loadUser(db, auth.collegeId, auth.id));
    if (!user) throw signedOut();
    return user;
  }

  private locked() {
    return apiError(
      423,
      'account_locked',
      `Too many wrong passwords. Try again in ${this.config.loginLockMinutes} minutes, or sign in with a mobile code.`,
    );
  }

  private async collegeIdFor(subdomain: string | undefined): Promise<string> {
    const name = (subdomain ?? this.config.defaultCollegeSubdomain ?? '').trim().toLowerCase();
    const collegeId = SUBDOMAIN.test(name) ? await this.prisma.resolveCollegeId(name) : null;
    if (!collegeId) {
      throw apiError(404, 'college_not_found', 'We could not find this college. Check the web address.');
    }
    // A suspended college cannot sign in or renew a session (set by the YuCampus team, decided 2026-10-18).
    const college = await this.prisma.forTenant(collegeId, (db) => db.college.findUnique({ where: { id: collegeId }, select: { status: true } }));
    if (college?.status === 'suspended') {
      throw apiError(403, 'college_suspended', 'YuCampus is paused for this college. Please contact your college admin or YuCampus support.');
    }
    return collegeId;
  }

  private async startSession(
    db: TenantClient,
    collegeId: string,
    userId: string,
    method: 'otp' | 'password' | 'google' | 'microsoft',
  ): Promise<StartedSession> {
    // Signing in for the first time is what turns an invited person into an active one.
    await db.user.update({
      where: { id: userId },
      data: { status: 'active', lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null },
    });
    await db.auditLog.create({
      data: { collegeId, userId, entity: 'user', entityId: userId, action: 'sign_in', after: { method } },
    });
    const started = await this.issueTokens(db, collegeId, userId);
    if (!started) throw signedOut();
    return started;
  }

  private async issueTokens(db: TenantClient, collegeId: string, userId: string): Promise<StartedSession | null> {
    const user = await this.loadUser(db, collegeId, userId);
    if (!user) return null;

    const refresh = this.tokens.newRefreshToken();
    await db.refreshToken.create({
      data: {
        collegeId,
        userId,
        tokenHash: refresh.hash,
        expiresAt: new Date(Date.now() + this.config.refreshTokenDays * 24 * 60 * 60 * 1000),
      },
    });
    const accessToken = await this.tokens.signAccessToken({ id: userId, collegeId, roles: user.roles });
    return {
      session: { accessToken, expiresIn: this.config.accessTokenSeconds, user },
      refreshToken: refresh.token,
    };
  }

  private async loadUser(db: TenantClient, collegeId: string, userId: string): Promise<SessionUser | null> {
    const user = await db.user.findFirst({
      where: { id: userId, collegeId },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        status: true,
        roles: { select: { role: true, departmentId: true }, orderBy: { role: 'asc' } },
        college: { select: { id: true, name: true, type: true, subdomain: true } },
      },
    });
    if (!user?.college) return null;
    const permissions = await this.permissions.grantsFor(collegeId, user.roles, db);
    return { ...user, permissions, college: user.college };
  }
}
