import { type CanActivate, type ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_ROUTE, type PlatformAccess } from '../auth/decorators.js';
import { TokensService } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The YuCampus team member making a platform request. */
export interface PlatformActor {
  id: string;
  name: string;
  email: string;
}

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  platformAdmin?: PlatformActor;
}

/**
 * Guards @PlatformRoute() routes: a valid platform token of an active team member. College tokens are refused
 * (they carry no platform audience). The account is read on every request, so disabling someone takes effect at once.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<PlatformAccess | undefined>(PLATFORM_ROUTE, [context.getHandler(), context.getClass()]);
    if (access === undefined || access === 'open') return true;
    const request = context.switchToHttp().getRequest<RequestLike>();
    const header = request.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    const adminId = token ? await this.tokens.verifyPlatformToken(token) : null;
    const admin = adminId
      ? await this.prisma.platform.platformAdmin.findFirst({ where: { id: adminId, status: 'active' }, select: { id: true, name: true, email: true } })
      : null;
    if (!admin) throw apiError(401, 'unauthenticated', 'Please sign in.');
    request.platformAdmin = admin;
    return true;
  }
}

export const CurrentAdmin = createParamDecorator((_data: unknown, context: ExecutionContext): PlatformActor => {
  return context.switchToHttp().getRequest<{ platformAdmin: PlatformActor }>().platformAdmin;
});
