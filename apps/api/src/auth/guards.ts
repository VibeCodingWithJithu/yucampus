import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can } from '@yucampus/types';
import { apiError } from '../common/api-error.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { type AccessRule, IS_PUBLIC, PLATFORM_ROUTE, REQUIRED_ACCESS } from './decorators.js';
import { type AuthUser, TokensService } from './tokens.service.js';

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

/** Requires a valid access token on every route that is not @Public(), and attaches the user. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    // Platform routes are checked by PlatformGuard, with platform tokens only.
    if (this.reflector.getAllAndOverride<string>(PLATFORM_ROUTE, [context.getHandler(), context.getClass()])) return true;

    const request = context.switchToHttp().getRequest<RequestLike>();
    const header = request.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? await this.tokens.verifyAccessToken(token) : null;
    if (!user) throw apiError(401, 'unauthenticated', 'Please sign in.');
    request.user = user;
    return true;
  }
}

/**
 * Enforces @RequireSection / @RequirePermission / @RequireAnyPermission. Runs after AuthGuard.
 * Permissions come from the person's roles plus their college's adjustments, read fresh (cached briefly),
 * so a college's change applies without anyone signing in again.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const user = request.user;
    if (!user) return true; // A @Public() route.

    const grants = await this.permissions.grantsFor(user.collegeId, user.roles);
    user.grants = grants;

    const rules = this.reflector.getAllAndOverride<readonly AccessRule[] | undefined>(REQUIRED_ACCESS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rules || rules.length === 0) return true;
    if (!rules.some((rule) => can(grants, rule.permission, rule.scopes))) {
      throw apiError(403, 'forbidden', 'You do not have access to this. Ask your college admin if you need it.');
    }
    return true;
  }
}
