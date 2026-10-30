import { Global, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { Jobs } from '../jobs/jobs.js';
import { NotificationsService } from './notifications.service.js';

@Global()
@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule implements OnApplicationBootstrap {
  constructor(private readonly jobs: Jobs) {}

  /** Repeating background work. With Redis these are shared schedulers, so several API processes do not repeat them. */
  async onApplicationBootstrap() {
    await this.jobs.every('email.flush', 60_000);
    await this.jobs.every('email.digest', 60 * 60_000);
    await this.jobs.every('tasks.sweep', 15 * 60_000);
  }
}
