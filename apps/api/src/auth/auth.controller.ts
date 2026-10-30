import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SessionResponse, SessionUser } from '@yucampus/types';
import {
  type ForgotPasswordInput,
  type PasswordLoginInput,
  type SetPasswordInput,
  forgotPasswordSchema,
  setPasswordSchema,
  ssoFinishSchema,
  type RequestOtpInput,
  type VerifyOtpInput,
  passwordLoginSchema,
  requestOtpSchema,
  verifyOtpSchema,
} from '@yucampus/validation';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { apiError } from '../common/api-error.js';
import { ZodQuery } from '../common/params.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { AppConfig } from '../config.js';
import { AuthService, type StartedSession } from './auth.service.js';
import { SsoService, isSsoProvider } from './sso.service.js';
import { CurrentUser, Public } from './decorators.js';
import type { AuthUser } from './tokens.service.js';

const linkQuerySchema = z.object({ token: z.string().min(20).max(200) });

const REFRESH_COOKIE = 'yc_refresh';
/** Signed state of a Google / Microsoft sign-in in progress (10 minutes), sent only to the SSO routes. */
const SSO_COOKIE = 'yc_sso';
const SSO_COOKIE_PATH = '/api/v1/auth/sso';
const ssoStartQuerySchema = z.object({ college: z.string().trim().toLowerCase().max(63) });
// The browser sends the refresh cookie only to the auth routes, never with ordinary API calls.
const COOKIE_PATH = '/api/v1/auth';

const CollegeHeader = () =>
  ApiHeader({ name: 'x-college', required: false, description: 'College subdomain, e.g. "abc" for abc.yubhiantechnologies.in' });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
    private readonly sso: SsoService,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  @CollegeHeader()
  @ApiZodBody(requestOtpSchema)
  @ApiOperation({ summary: 'Send a one-time sign-in code to a mobile number' })
  requestOtp(@Headers('x-college') college: string | undefined, @Body(new ZodPipe(requestOtpSchema)) body: RequestOtpInput) {
    return this.auth.requestOtp(college, body.mobile);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  @CollegeHeader()
  @ApiZodBody(verifyOtpSchema)
  @ApiOperation({ summary: 'Sign in with the code that was sent' })
  async verifyOtp(
    @Headers('x-college') college: string | undefined,
    @Body(new ZodPipe(verifyOtpSchema)) body: VerifyOtpInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    return this.finish(response, await this.auth.verifyOtp(college, body.mobile, body.otp));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @CollegeHeader()
  @ApiZodBody(passwordLoginSchema)
  @ApiOperation({ summary: 'Sign in with email and password' })
  async login(
    @Headers('x-college') college: string | undefined,
    @Body(new ZodPipe(passwordLoginSchema)) body: PasswordLoginInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    return this.finish(response, await this.auth.loginWithPassword(college, body.email, body.password));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @CollegeHeader()
  @ApiOperation({ summary: 'Get a new access token using the refresh cookie' })
  async refresh(
    @Headers('x-college') college: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    try {
      return this.finish(response, await this.auth.refresh(college, readCookie(request, REFRESH_COOKIE)));
    } catch (error) {
      response.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @CollegeHeader()
  @ApiOperation({ summary: 'Sign out on this device' })
  async logout(
    @Headers('x-college') college: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(college, readCookie(request, REFRESH_COOKIE));
    response.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  @CollegeHeader()
  @ApiZodBody(forgotPasswordSchema)
  @ApiOperation({ summary: 'Email a link to choose a new password. Answers the same whether or not the email is known' })
  forgotPassword(@Headers('x-college') college: string | undefined, @Body(new ZodPipe(forgotPasswordSchema)) body: ForgotPasswordInput) {
    return this.auth.forgotPassword(college, body.email);
  }

  @Public()
  @Get('password/link')
  @CollegeHeader()
  @ApiOperation({ summary: 'Whether an invite or reset link still works, and whose it is' })
  passwordLink(@Headers('x-college') college: string | undefined, @ZodQuery(linkQuerySchema) query: { token: string }) {
    return this.auth.passwordLink(college, query.token);
  }

  @Public()
  @Post('password/set')
  @HttpCode(200)
  @CollegeHeader()
  @ApiZodBody(setPasswordSchema)
  @ApiOperation({ summary: 'Choose a password from an invite or reset link, then sign in' })
  async setPassword(
    @Headers('x-college') college: string | undefined,
    @Body(new ZodPipe(setPasswordSchema)) body: SetPasswordInput,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    return this.finish(response, await this.auth.setPassword(college, body.token, body.password));
  }

  @Public()
  @Get('sso/options')
  @CollegeHeader()
  @ApiOperation({ summary: 'Google / Microsoft sign-in buttons to show: turned on by the college and set up on this server' })
  ssoOptions(@Headers('x-college') college: string | undefined) {
    return this.sso.options(college ?? this.config.defaultCollegeSubdomain ?? '');
  }

  @Public()
  @Get('sso/:provider/start')
  @ApiOperation({ summary: 'Starts Google / Microsoft sign-in for a college (?college=<subdomain>); redirects to the provider' })
  async ssoStart(
    @Param('provider') provider: string,
    @ZodQuery(ssoStartQuerySchema) query: { college: string },
    @Res() response: Response,
  ): Promise<void> {
    if (!isSsoProvider(provider)) throw apiError(404, 'not_found', 'Unknown sign-in provider.');
    const started = await this.sso.start(provider, query.college);
    if (started.cookie) {
      response.cookie(SSO_COOKIE, started.cookie, {
        httpOnly: true,
        secure: this.config.isProduction,
        // Lax: the provider sends the browser back with a top-level GET, which must carry this cookie.
        sameSite: 'lax',
        path: SSO_COOKIE_PATH,
        maxAge: 10 * 60 * 1000,
      });
    }
    response.redirect(302, started.redirect);
  }

  @Public()
  @Get('sso/:provider/callback')
  @ApiOperation({ summary: 'Where Google / Microsoft send the browser back; continues on the college\'s own address' })
  async ssoCallback(
    @Param('provider') provider: string,
    @Query() query: Record<string, string | undefined>,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const cookie = readCookie(request, SSO_COOKIE);
    response.clearCookie(SSO_COOKIE, { path: SSO_COOKIE_PATH });
    if (!isSsoProvider(provider)) throw apiError(404, 'not_found', 'Unknown sign-in provider.');
    const pick = (key: string) => (typeof query[key] === 'string' ? query[key]!.slice(0, 2000) : undefined);
    response.redirect(302, await this.sso.callback(provider, { code: pick('code'), state: pick('state'), error: pick('error') }, cookie));
  }

  @Public()
  @Post('sso/finish')
  @HttpCode(200)
  @CollegeHeader()
  @ApiZodBody(ssoFinishSchema)
  @ApiOperation({ summary: 'Finishes Google / Microsoft sign-in on the college address with the one-time code' })
  async ssoFinish(
    @Headers('x-college') college: string | undefined,
    @Body(new ZodPipe(ssoFinishSchema)) body: { code: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponse> {
    return this.finish(response, await this.auth.finishSso(college, body.code));
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The signed-in person, their roles and their college' })
  me(@CurrentUser() user: AuthUser): Promise<SessionUser> {
    return this.auth.me(user);
  }

  private finish(response: Response, started: StartedSession): SessionResponse {
    response.cookie(REFRESH_COOKIE, started.refreshToken, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: COOKIE_PATH,
      maxAge: this.config.refreshTokenDays * 24 * 60 * 60 * 1000,
    });
    return started.session;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}
