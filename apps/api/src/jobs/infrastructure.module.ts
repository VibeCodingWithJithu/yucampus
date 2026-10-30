import { Global, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../config.js';
import { ConsoleEmailSender, EmailSender, SmtpEmailSender } from '../mail/email-sender.js';
import { BullJobs, InProcessJobs, Jobs } from './jobs.js';

@Global()
@Module({
  providers: [
    {
      provide: Jobs,
      inject: [AppConfig],
      useFactory: (config: AppConfig): Jobs => {
        if (config.redisUrl) return new BullJobs(config.redisUrl);
        new Logger('Jobs').warn('No REDIS_URL: background jobs run inside the API process (fine for local work).');
        return new InProcessJobs();
      },
    },
    {
      provide: EmailSender,
      inject: [AppConfig],
      useFactory: (config: AppConfig): EmailSender => {
        if (config.smtpUrl) return new SmtpEmailSender(config.smtpUrl, config.mailFrom);
        new Logger('Email').warn('No SMTP_URL: emails are printed here instead of being sent.');
        return new ConsoleEmailSender();
      },
    },
  ],
  exports: [Jobs, EmailSender],
})
export class InfrastructureModule implements OnApplicationShutdown {
  constructor(private readonly jobs: Jobs) {}

  async onApplicationShutdown() {
    await this.jobs.close();
  }
}
