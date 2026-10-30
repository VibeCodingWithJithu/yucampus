import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { ApiExceptionFilter } from './common/api-error.js';
import { ConfigModule } from './config.module.js';
import { HealthController } from './health/health.controller.js';
import { TlsController } from './health/tls.controller.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AccreditationModule } from './accreditation/accreditation.module.js';
import { EvidenceModule } from './evidence/evidence.module.js';
import { InfrastructureModule } from './jobs/infrastructure.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { NbaModule } from './nba/nba.module.js';
import { NirfModule } from './nirf/nirf.module.js';
import { AisheModule } from './aishe/aishe.module.js';
import { AuditLogModule } from './audit-log/audit-log.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { RegistersModule } from './registers/registers.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SurveysModule } from './surveys/surveys.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { SetupModule } from './setup/setup.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, StorageModule, InfrastructureModule, NotificationsModule, PermissionsModule, AuthModule, SetupModule, UsersModule, AccreditationModule, EvidenceModule, TasksModule, DashboardModule, ReportsModule, RegistersModule, NbaModule, SurveysModule, NirfModule, AisheModule, AuditLogModule, PlatformModule],
  controllers: [HealthController, TlsController],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
