import { createHash, randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { apiError } from '../common/api-error.js';
import { AppConfig } from '../config.js';
import { Jobs } from '../jobs/jobs.js';
import { EmailSender } from '../mail/email-sender.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';

export type LinkPurpose = 'invite' | 'reset';

const LIFETIME_MS: Record<LinkPurpose, number> = {
  invite: 7 * 24 * 60 * 60 * 1000,
  reset: 60 * 60 * 1000,
};
/** A second "forgot password" within this time sends nothing, so the form cannot be used to flood an inbox. */
const RESET_PAUSE_MS = 2 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const badLink = () => apiError(410, 'link_expired', 'This link has expired or was already used. Ask for a new one.');

/**
 * One-time links to choose a password: an invite for someone just added, or a reset after "Forgot password?".
 * Only a hash of the token is stored. Emails go out from background jobs that carry ids, never tokens, and the
 * "forgot password" answer is the same whether or not the email belongs to anyone.
 */
@Injectable()
export class PasswordLinksService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: Jobs,
    private readonly email: EmailSender,
    private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.jobs.register('auth.invite', async (data) => {
      await this.sendInvites(String(data.collegeId), (data.userIds as string[]) ?? []);
    });
    this.jobs.register('auth.reset', async (data) => {
      await this.sendReset(String(data.collegeId), String(data.email));
    });
  }

  /** Emails an invite (a link to choose a password) to each person who has an email address. Call after saving. */
  async invite(collegeId: string, userIds: readonly string[]) {
    if (userIds.length > 0) await this.jobs.enqueue('auth.invite', { collegeId, userIds: [...userIds] });
  }

  async requestReset(collegeId: string, email: string) {
    await this.jobs.enqueue('auth.reset', { collegeId, email });
  }

  /** What the "choose a password" page shows before the person types anything. */
  async describe(collegeId: string, token: string): Promise<{ purpose: LinkPurpose; name: string; email: string | null }> {
    const link = await this.prisma.forTenant(collegeId, (db) =>
      db.passwordLink.findFirst({
        where: { collegeId, tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: new Date() } },
        select: { purpose: true, user: { select: { name: true, email: true } } },
      }),
    );
    if (!link) throw badLink();
    return { purpose: link.purpose as LinkPurpose, name: link.user.name, email: link.user.email };
  }

  /** Marks the link used and returns whose it is. Inside the caller's transaction, so a failure leaves it unused. */
  async use(db: TenantClient, collegeId: string, token: string): Promise<{ userId: string; purpose: LinkPurpose }> {
    const link = await db.passwordLink.findFirst({
      where: { collegeId, tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!link) throw badLink();
    const marked = await db.passwordLink.updateMany({ where: { id: link.id, usedAt: null }, data: { usedAt: new Date() } });
    if (marked.count !== 1) throw badLink();
    return { userId: link.userId, purpose: link.purpose as LinkPurpose };
  }

  // ---------------------------------------------------------------- Background jobs

  async sendInvites(collegeId: string, userIds: readonly string[]): Promise<number> {
    const created = await this.prisma.forTenant(collegeId, async (db) => {
      const users = await db.user.findMany({
        where: { collegeId, id: { in: [...userIds] }, email: { not: null } },
        select: { id: true, name: true, email: true },
      });
      const out = [];
      for (const user of users) out.push({ user, token: await this.newLink(db, collegeId, user.id, 'invite') });
      return { out, college: await db.college.findUniqueOrThrow({ where: { id: collegeId }, select: { name: true, subdomain: true } }) };
    });
    const base = this.config.appUrl(created.college.subdomain);
    for (const { user, token } of created.out) {
      await this.email.send({
        to: user.email!,
        subject: `You have been added to YuCampus at ${created.college.name}`,
        text: `Hello ${user.name},\n\nYou have been added to YuCampus, the accreditation workspace of ${created.college.name}. Choose a password to sign in. The link works for 7 days.\n\nYou can also sign in with a one-time code sent to your mobile number, if your college added one.`,
        action: { label: 'Choose a password', url: `${base}/reset-password?token=${token}` },
      });
    }
    return created.out.length;
  }

  async sendReset(collegeId: string, email: string): Promise<boolean> {
    const found = await this.prisma.forTenant(collegeId, async (db) => {
      const user = await db.user.findFirst({ where: { collegeId, email }, select: { id: true, name: true, email: true } });
      if (!user) return null;
      const recent = await db.passwordLink.count({
        where: { collegeId, userId: user.id, purpose: 'reset', createdAt: { gt: new Date(Date.now() - RESET_PAUSE_MS) } },
      });
      if (recent > 0) return null;
      const token = await this.newLink(db, collegeId, user.id, 'reset');
      const college = await db.college.findUniqueOrThrow({ where: { id: collegeId }, select: { name: true, subdomain: true } });
      return { user, token, college };
    });
    if (!found) return false;
    await this.email.send({
      to: found.user.email!,
      subject: 'Reset your YuCampus password',
      text: `Hello ${found.user.name},\n\nSomeone asked to reset the password of your YuCampus account at ${found.college.name}. The link works for 60 minutes and only once.\n\nIf it was not you, ignore this email: your password stays the same.`,
      action: { label: 'Choose a new password', url: `${this.config.appUrl(found.college.subdomain)}/reset-password?token=${found.token}` },
    });
    return true;
  }

  /** A new link replaces any earlier unused link of the same kind. */
  private async newLink(db: TenantClient, collegeId: string, userId: string, purpose: LinkPurpose): Promise<string> {
    await db.passwordLink.updateMany({ where: { collegeId, userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    const token = randomBytes(32).toString('base64url');
    await db.passwordLink.create({
      data: { collegeId, userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + LIFETIME_MS[purpose]) },
    });
    return token;
  }
}
