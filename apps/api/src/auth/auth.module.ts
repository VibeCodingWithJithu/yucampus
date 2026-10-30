import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfig } from '../config.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard, PermissionsGuard } from './guards.js';
import { ConsoleOtpSender, OtpSender, UnavailableOtpSender } from './otp-sender.js';
import { PasswordLinksService } from './password-links.service.js';
import { SsoService } from './sso.service.js';
import { TokensService } from './tokens.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    PasswordLinksService,
    SsoService,
    {
      provide: OtpSender,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => (config.isProduction ? new UnavailableOtpSender() : new ConsoleOtpSender()),
    },
    // Order matters: AuthGuard identifies the user, then PermissionsGuard checks what they may do.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [PasswordLinksService, TokensService],
})
export class AuthModule {}
