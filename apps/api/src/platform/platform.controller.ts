import { Body, Controller, Get, HttpCode, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformChallenge, PlatformSession } from '@yucampus/types';
import {
  type CollegePlanInput,
  type CollegeStatusInput,
  type CreateCollegeValues,
  type PasswordLoginInput,
  type PlatformCollegeQuery,
  type PlatformInviteInput,
  type PlatformMfaInput,
  type SetPasswordInput,
  collegePlanSchema,
  collegeStatusSchema,
  createCollegeSchema,
  passwordLoginSchema,
  platformCollegeQuerySchema,
  platformInviteSchema,
  platformMfaSchema,
  setPasswordSchema,
} from '@yucampus/validation';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PlatformRoute } from '../auth/decorators.js';
import { IdParam, ZodQuery } from '../common/params.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { AppConfig } from '../config.js';
import { PlatformAuthService, type StartedPlatformSession } from './platform-auth.service.js';
import { CurrentAdmin, type PlatformActor } from './platform-guard.js';
import { PlatformService } from './platform.service.js';

const REFRESH_COOKIE = 'yc_platform_refresh';
// Separate from the college cookie, and sent only to the platform's auth routes.
const COOKIE_PATH = '/api/v1/platform/auth';
const linkQuerySchema = z.object({ token: z.string().min(20).max(200) });

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

@ApiTags('platform')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly config: AppConfig,
  ) {}

  @PlatformRoute('open')
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(passwordLoginSchema)
  @ApiOperation({ summary: 'YuCampus team sign-in, step one: the password. Returns a ticket for the authenticator step' })
  login(@Body(new ZodPipe(passwordLoginSchema)) body: PasswordLoginInput): Promise<PlatformChallenge> {
    return this.auth.login(body.email, body.password);
  }

  @PlatformRoute('open')
  @Post('mfa')
  @HttpCode(200)
  @ApiZodBody(platformMfaSchema)
  @ApiOperation({ summary: 'Step two: the ticket and a code from the authenticator app (or a recovery code). Starts the session' })
  async mfa(@Body(new ZodPipe(platformMfaSchema)) body: PlatformMfaInput, @Res({ passthrough: true }) response: Response): Promise<PlatformSession> {
    return this.finish(response, await this.auth.verifyMfa(body.ticket, body.code));
  }

  @PlatformRoute('open')
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'New platform access token from the refresh cookie' })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<PlatformSession> {
    try {
      return this.finish(response, await this.auth.refresh(readCookie(request, REFRESH_COOKIE)));
    } catch (error) {
      response.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      throw error;
    }
  }

  @PlatformRoute('open')
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(readCookie(request, REFRESH_COOKIE));
    response.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @PlatformRoute('open')
  @Get('password/link')
  @ApiOperation({ summary: 'Whether a team invite or reset link still works, and whose it is' })
  link(@ZodQuery(linkQuerySchema) query: { token: string }) {
    return this.auth.describeLink(query.token);
  }

  @PlatformRoute('open')
  @Post('password/set')
  @HttpCode(200)
  @ApiZodBody(setPasswordSchema)
  @ApiOperation({ summary: 'Choose a password from a team link. Signing in then continues with the authenticator step' })
  setPassword(@Body(new ZodPipe(setPasswordSchema)) body: SetPasswordInput): Promise<PlatformChallenge> {
    return this.auth.setPassword(body.token, body.password);
  }

  @PlatformRoute()
  @Get('me')
  @ApiBearerAuth()
  me(@CurrentAdmin() admin: PlatformActor) {
    return this.auth.me(admin);
  }

  private finish(response: Response, started: StartedPlatformSession): PlatformSession {
    response.cookie(REFRESH_COOKIE, started.refreshToken, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: this.config.platformRefreshHours * 3_600_000,
    });
    return started.session;
  }
}

@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
@PlatformRoute()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('colleges')
  @ApiOperation({ summary: 'Every college: profile, status, plan and counts (no college data)' })
  colleges(@ZodQuery(platformCollegeQuerySchema) query: PlatformCollegeQuery) {
    return this.platform.colleges(query);
  }

  @Post('colleges')
  @ApiZodBody(createCollegeSchema)
  @ApiOperation({ summary: 'Set up a college and invite its first college admin' })
  create(@CurrentAdmin() admin: PlatformActor, @Body(new ZodPipe(createCollegeSchema)) body: CreateCollegeValues) {
    return this.platform.createCollege(admin, body);
  }

  @Get('colleges/:id')
  college(@IdParam() id: string) {
    return this.platform.college(id);
  }

  @Put('colleges/:id/status')
  @ApiZodBody(collegeStatusSchema)
  @ApiOperation({ summary: 'Suspend or reactivate a college' })
  status(@CurrentAdmin() admin: PlatformActor, @IdParam() id: string, @Body(new ZodPipe(collegeStatusSchema)) body: CollegeStatusInput) {
    return this.platform.setStatus(admin, id, body);
  }

  @Put('colleges/:id/plan')
  @ApiZodBody(collegePlanSchema)
  plan(@CurrentAdmin() admin: PlatformActor, @IdParam() id: string, @Body(new ZodPipe(collegePlanSchema)) body: CollegePlanInput) {
    return this.platform.setPlan(admin, id, body);
  }

  @Post('colleges/:id/resend-invite')
  @HttpCode(200)
  resendInvite(@CurrentAdmin() admin: PlatformActor, @IdParam() id: string) {
    return this.platform.resendInvite(admin, id);
  }

  @Get('rules')
  @ApiOperation({ summary: 'Loaded rules (read only): frameworks, registers and rule files, with checked status and use' })
  rules() {
    return this.platform.rules();
  }

  @Get('admins')
  admins() {
    return this.platform.admins();
  }

  @Post('admins')
  @ApiZodBody(platformInviteSchema)
  invite(@CurrentAdmin() admin: PlatformActor, @Body(new ZodPipe(platformInviteSchema)) body: PlatformInviteInput) {
    return this.platform.invite(admin, body);
  }

  @Put('admins/:id/disabled')
  @HttpCode(200)
  disable(@CurrentAdmin() admin: PlatformActor, @IdParam() id: string) {
    return this.platform.setAdminEnabled(admin, id, false);
  }

  @Put('admins/:id/enabled')
  @HttpCode(200)
  enable(@CurrentAdmin() admin: PlatformActor, @IdParam() id: string) {
    return this.platform.setAdminEnabled(admin, id, true);
  }

  @Post('admins/:id/password-link')
  @HttpCode(200)
  passwordLink(@CurrentAdmin() admin: PlatformActor, @IdParam() id: string) {
    return this.platform.sendPasswordLink(admin, id);
  }

  @Post('admins/:id/reset-mfa')
  @HttpCode(200)
  @ApiOperation({ summary: "Reset a team member's authenticator (lost phone). They set it up again at next sign-in" })
  resetMfa(@CurrentAdmin() admin: PlatformActor, @IdParam() id: string) {
    return this.platform.resetMfa(admin, id);
  }

  @Get('audit')
  @ApiOperation({ summary: 'The platform audit log: what the YuCampus team did, newest first' })
  audit() {
    return this.platform.audit();
  }
}
