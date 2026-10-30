import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type Grant, ROLES, type Role, type RoleAssignment } from '@yucampus/types';
import { SignJWT, jwtVerify } from 'jose';
import { AppConfig } from '../config.js';

/** Who is making the request, as carried by a verified access token. */
export interface AuthUser {
  id: string;
  collegeId: string;
  roles: RoleAssignment[];
  /** Filled in by PermissionsGuard for each request. */
  grants?: Grant[];
}

const ISSUER = 'yucampus';
/** Platform (YuCampus team) tokens carry this audience; college tokens carry none. */
const PLATFORM_AUDIENCE = 'platform';
/** The sign-in ticket between password and authenticator code. */
const MFA_AUDIENCE = 'platform-mfa';

@Injectable()
export class TokensService {
  constructor(private readonly config: AppConfig) {}

  signAccessToken(user: AuthUser): Promise<string> {
    return new SignJWT({ cid: user.collegeId, roles: user.roles.map(({ role, departmentId }) => [role, departmentId]) })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTokenSeconds}s`)
      .sign(this.config.jwtSecret);
  }

  /** Returns null for anything that is not a valid, unexpired token signed by us. */
  async verifyAccessToken(token: string): Promise<AuthUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, { issuer: ISSUER, algorithms: ['HS256'] });
      const { sub, cid, roles, aud } = payload;
      // A platform token is never a college session.
      if (aud !== undefined) return null;
      if (typeof sub !== 'string' || typeof cid !== 'string' || !Array.isArray(roles)) return null;
      return {
        id: sub,
        collegeId: cid,
        roles: roles
          .filter((entry): entry is [Role, string | null] => Array.isArray(entry) && ROLES.includes(entry[0]))
          .map(([role, departmentId]) => ({ role, departmentId: departmentId ?? null })),
      };
    } catch {
      return null;
    }
  }

  /** A YuCampus team member's access token: no college, audience "platform". */
  signPlatformToken(adminId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(adminId)
      .setIssuer(ISSUER)
      .setAudience(PLATFORM_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTokenSeconds}s`)
      .sign(this.config.jwtSecret);
  }

  /** The team member's id, or null for anything else (including every college token). */
  async verifyPlatformToken(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.config.jwtSecret, { issuer: ISSUER, audience: PLATFORM_AUDIENCE, algorithms: ['HS256'] });
      return typeof payload.sub === 'string' && payload.cid === undefined ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /** The 5-minute ticket between the password and the authenticator code. It opens nothing else. */
  signMfaTicket(adminId: string, enroll: boolean): Promise<string> {
    return new SignJWT({ enr: enroll })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(adminId)
      .setIssuer(ISSUER)
      .setAudience(MFA_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.config.jwtSecret);
  }

  async verifyMfaTicket(ticket: string): Promise<{ adminId: string; enroll: boolean } | null> {
    try {
      const { payload } = await jwtVerify(ticket, this.config.jwtSecret, { issuer: ISSUER, audience: MFA_AUDIENCE, algorithms: ['HS256'] });
      return typeof payload.sub === 'string' ? { adminId: payload.sub, enroll: payload.enr === true } : null;
    } catch {
      return null;
    }
  }

  /** A random refresh token. The client gets `token`; the database only ever stores `hash`. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('base64url');
  }

  newOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  /** Keyed hash, so a leaked database row cannot simply be tried against all one million codes. */
  hashOtp(collegeId: string, mobile: string, code: string): string {
    return createHmac('sha256', this.config.jwtSecret).update(`otp:${collegeId}:${mobile}:${code}`).digest('base64url');
  }

  otpMatches(collegeId: string, mobile: string, code: string, storedHash: string): boolean {
    const actual = Buffer.from(this.hashOtp(collegeId, mobile, code));
    const expected = Buffer.from(storedHash);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
