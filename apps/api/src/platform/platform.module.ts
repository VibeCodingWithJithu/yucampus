import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformAuthService } from './platform-auth.service.js';
import { PlatformAuthController, PlatformController } from './platform.controller.js';
import { PlatformGuard } from './platform-guard.js';
import { PlatformService } from './platform.service.js';

/** The YuCampus team's panel (docs/ARCHITECTURE.md "Platform panel"). */
@Module({
  imports: [AuthModule],
  controllers: [PlatformAuthController, PlatformController],
  providers: [PlatformAuthService, PlatformService, { provide: APP_GUARD, useClass: PlatformGuard }],
})
export class PlatformModule {}
