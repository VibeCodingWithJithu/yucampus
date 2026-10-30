import { PasswordLinksService } from '../src/auth/password-links.service.js';
import { AppConfig } from '../src/config.js';
import { InProcessJobs } from '../src/jobs/jobs.js';
import { ConsoleEmailSender } from '../src/mail/email-sender.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

/** Notifications for service tests: saved in the database, but no emails go out in the background. */
export function notificationsFor(prisma: PrismaService) {
  const jobs = new InProcessJobs();
  jobs.register('email.flush', async () => {});
  return new NotificationsService(prisma, jobs, new ConsoleEmailSender(), new AppConfig());
}

/**
 * Password links for service tests. With `send`, invite and reset jobs run right away in the background and sent
 * emails are kept in `email.sent`; without it they do nothing.
 */
export function linksFor(prisma: PrismaService, config = new AppConfig(), send = false) {
  const jobs = new InProcessJobs();
  const email = new ConsoleEmailSender();
  const links = new PasswordLinksService(prisma, jobs, email, config);
  if (send) links.onModuleInit();
  else for (const name of ['auth.invite', 'auth.reset']) jobs.register(name, async () => {});
  return { links, email, jobs };
}
