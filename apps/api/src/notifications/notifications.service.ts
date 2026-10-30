import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  DEFAULT_CHANNELS,
  EVENT_OF_KIND,
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_LABELS,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationKind,
  type NotificationPage,
  type NotificationPreferences,
} from '@yucampus/types';
import type { NotificationPreferencesInput, NotificationsQuery } from '@yucampus/validation';
import type { AuthUser } from '../auth/tokens.service.js';
import { AppConfig } from '../config.js';
import { Jobs } from '../jobs/jobs.js';
import { EmailSender } from '../mail/email-sender.js';
import { PrismaService, type TenantClient } from '../prisma/prisma.service.js';

export interface NewNotification {
  collegeId: string;
  userIds: readonly string[];
  kind: NotificationKind;
  text: string;
  /** In-app path, e.g. /tasks?task=<id>. */
  link?: string | null;
  /** Sends this notification at most once per person, e.g. "task:<id>:due:2026-10-31:3". */
  dedupeKey?: string | null;
}

const PAGE_SIZE = 30;
/** notify() runs inside the caller's transaction; the email job waits this long so the rows are committed first. */
const FLUSH_DELAY_MS = 2000;
/** Notifications older than this are never emailed (e.g. after an outage), only shown in the app. */
const EMAIL_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/** "Today" and the hour in India, for reminders and daily summaries. */
export function indiaNow(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return { date: ist.toISOString().slice(0, 10), hour: ist.getUTCHours() };
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: Jobs,
    private readonly email: EmailSender,
    private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.jobs.register('email.flush', async () => {
      await this.flushEmails();
    });
    this.jobs.register('email.digest', async () => {
      await this.sendDigests();
    });
  }

  /** Every college, one at a time, for background jobs. */
  async collegeIds(): Promise<string[]> {
    return this.prisma.collegeIds();
  }

  /**
   * Adds in-app notifications (inside the caller's transaction) and asks for emails to go out. Emails are sent
   * from what is saved (an outbox), so nothing is emailed for a change that is rolled back.
   */
  async notify(db: TenantClient, input: NewNotification): Promise<number> {
    const userIds = [...new Set(input.userIds)];
    if (userIds.length === 0) return 0;
    const result = await db.notification.createMany({
      data: userIds.map((userId) => ({
        collegeId: input.collegeId,
        userId,
        kind: input.kind,
        text: input.text,
        link: input.link ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })),
      skipDuplicates: true,
    });
    if (result.count > 0) await this.jobs.enqueue('email.flush', {}, FLUSH_DELAY_MS);
    return result.count;
  }

  // ---------------------------------------------------------------- In-app list

  async list(actor: AuthUser, query: NotificationsQuery): Promise<NotificationPage> {
    const kinds: Record<NotificationsQuery['filter'], NotificationKind[] | null> = {
      all: null,
      unread: null,
      deadlines: ['task_due', 'task_overdue', 'key_date'],
      tasks: ['task_assigned', 'task_due', 'task_overdue'],
    };
    const where = {
      collegeId: actor.collegeId,
      userId: actor.id,
      ...(query.filter === 'unread' ? { readAt: null } : {}),
      ...(kinds[query.filter] ? { kind: { in: kinds[query.filter]! } } : {}),
    };
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const [rows, total, unread] = await Promise.all([
        db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
        db.notification.count({ where }),
        db.notification.count({ where: { collegeId: actor.collegeId, userId: actor.id, readAt: null } }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          kind: row.kind as NotificationKind,
          text: row.text,
          link: row.link,
          read: row.readAt !== null,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
        unread,
      };
    });
  }

  async unreadCount(actor: AuthUser): Promise<{ unread: number }> {
    const unread = await this.prisma.forTenant(actor.collegeId, (db) =>
      db.notification.count({ where: { collegeId: actor.collegeId, userId: actor.id, readAt: null } }),
    );
    return { unread };
  }

  /** Marks some (or, with no ids, all) of the person's notifications as read. Never anyone else's. */
  async markRead(actor: AuthUser, ids?: readonly string[]): Promise<{ unread: number }> {
    await this.prisma.forTenant(actor.collegeId, (db) =>
      db.notification.updateMany({
        where: { collegeId: actor.collegeId, userId: actor.id, readAt: null, ...(ids ? { id: { in: [...ids] } } : {}) },
        data: { readAt: new Date() },
      }),
    );
    return this.unreadCount(actor);
  }

  // ---------------------------------------------------------------- Preferences

  async preferences(actor: AuthUser): Promise<NotificationPreferences> {
    return this.prisma.forTenant(actor.collegeId, async (db) => {
      const [rows, user] = await Promise.all([
        db.notificationPreference.findMany({ where: { collegeId: actor.collegeId, userId: actor.id } }),
        db.user.findFirstOrThrow({ where: { id: actor.id, collegeId: actor.collegeId }, select: { emailDigest: true } }),
      ]);
      const chosen = new Map(rows.map((row) => [row.event, row.channels]));
      return {
        events: NOTIFICATION_EVENTS.map((event) => ({
          event,
          label: NOTIFICATION_EVENT_LABELS[event],
          // In-app is always on: it is the list itself.
          channels: [...new Set<NotificationChannel>(['in_app', ...(chosen.get(event) ?? DEFAULT_CHANNELS[event])])],
        })),
        emailDigest: (['instant', '09', '17'].includes(user.emailDigest) ? user.emailDigest : 'instant') as NotificationPreferences['emailDigest'],
      };
    });
  }

  async setPreferences(actor: AuthUser, input: NotificationPreferencesInput): Promise<NotificationPreferences> {
    await this.prisma.forTenant(actor.collegeId, async (db) => {
      for (const { event, channels } of input.events) {
        // WhatsApp is not connected yet: it cannot be switched on.
        const kept = [...new Set<NotificationChannel>(['in_app', ...channels.filter((c) => c !== 'whatsapp')])];
        await db.notificationPreference.upsert({
          where: { userId_event: { userId: actor.id, event } },
          create: { collegeId: actor.collegeId, userId: actor.id, event, channels: kept },
          update: { channels: kept },
        });
      }
      await db.user.update({ where: { id: actor.id }, data: { emailDigest: input.emailDigest } });
    });
    return this.preferences(actor);
  }

  // ---------------------------------------------------------------- Email (background jobs)

  /** People who want email for an event, from their choices or the defaults. */
  private async emailWanted(db: TenantClient, collegeId: string, userIds: string[]) {
    const prefs = await db.notificationPreference.findMany({ where: { collegeId, userId: { in: userIds } } });
    const chosen = new Map(prefs.map((p) => [`${p.userId}:${p.event}`, p.channels]));
    return (userId: string, event: NotificationEvent) => (chosen.get(`${userId}:${event}`) ?? DEFAULT_CHANNELS[event]).includes('email');
  }

  /**
   * Emails notifications to people who want them right away. Runs after each new notification and every minute.
   * Each email is claimed (emailed_at set) before it is sent, so overlapping runs never send one twice.
   */
  async flushEmails(): Promise<number> {
    let sent = 0;
    for (const collegeId of await this.collegeIds()) {
      sent += await this.prisma.forTenant(collegeId, (db) => this.flushCollege(db, collegeId, 'instant'));
    }
    return sent;
  }

  /** Sends daily summaries at 09:00 and 17:00 India time to people who chose them. Runs every hour. */
  async sendDigests(now = new Date()): Promise<number> {
    const { hour } = indiaNow(now);
    const digest = hour === 9 ? '09' : hour === 17 ? '17' : null;
    if (!digest) return 0;
    let sent = 0;
    for (const collegeId of await this.collegeIds()) {
      sent += await this.prisma.forTenant(collegeId, (db) => this.flushCollege(db, collegeId, digest));
    }
    return sent;
  }

  private async flushCollege(db: TenantClient, collegeId: string, digest: 'instant' | '09' | '17'): Promise<number> {
    const pending = await db.notification.findMany({
      where: { collegeId, emailedAt: null, createdAt: { gt: new Date(Date.now() - EMAIL_WINDOW_MS) } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    if (pending.length === 0) return 0;
    const users = await db.user.findMany({
      where: { collegeId, id: { in: [...new Set(pending.map((n) => n.userId))] }, emailDigest: digest, email: { not: null } },
      select: { id: true, name: true, email: true },
    });
    if (users.length === 0) return 0;
    const college = await db.college.findUniqueOrThrow({ where: { id: collegeId }, select: { name: true, subdomain: true } });
    const wants = await this.emailWanted(db, collegeId, users.map((u) => u.id));
    const base = this.config.appUrl(college.subdomain);

    let sent = 0;
    for (const user of users) {
      const mine = pending.filter((n) => n.userId === user.id && wants(user.id, EVENT_OF_KIND[n.kind as NotificationKind] ?? 'task_assigned'));
      if (mine.length === 0) continue;
      try {
        if (digest === 'instant') {
          for (const n of mine) {
            if (!(await this.claim(db, [n.id]))) continue;
            await this.sendOrRelease(db, [n.id], {
              to: user.email!,
              subject: n.text.length > 90 ? `${n.text.slice(0, 87)}…` : n.text,
              text: `Hello ${user.name},\n\n${n.text}`,
              action: n.link ? { label: 'Open in YuCampus', url: `${base}${n.link}` } : { label: 'Open YuCampus', url: base },
            });
            sent++;
          }
        } else {
          const ids = mine.map((n) => n.id);
          if (!(await this.claim(db, ids))) continue;
          await this.sendOrRelease(db, ids, {
            to: user.email!,
            subject: `YuCampus: ${mine.length} update${mine.length === 1 ? '' : 's'} for you at ${college.name}`,
            text: `Hello ${user.name},\n\nHere is what happened since your last summary:\n\n${mine.map((n) => `• ${n.text}`).join('\n')}`,
            action: { label: 'Open notifications', url: `${base}/notifications` },
          });
          sent++;
        }
      } catch (error) {
        // Left unsent; the next run tries again.
        this.logger.warn(`Email to user ${user.id} failed: ${String(error)}`);
      }
    }
    return sent;
  }

  /** Marks notifications as emailed before sending. False if an overlapping run got there first. */
  private async claim(db: TenantClient, ids: string[]): Promise<boolean> {
    const claimed = await db.notification.updateMany({ where: { id: { in: ids }, emailedAt: null }, data: { emailedAt: new Date() } });
    return claimed.count === ids.length;
  }

  /** Sends, or on failure releases the claim so the next run tries again. */
  private async sendOrRelease(db: TenantClient, ids: string[], email: Parameters<EmailSender['send']>[0]) {
    try {
      await this.email.send(email);
    } catch (error) {
      await db.notification.updateMany({ where: { id: { in: ids } }, data: { emailedAt: null } });
      throw error;
    }
  }
}
