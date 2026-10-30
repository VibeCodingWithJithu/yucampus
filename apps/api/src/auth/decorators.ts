import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { type Permission, SECTION_ACCESS, type Scope, type Section } from '@yucampus/types';
import type { AuthUser } from './tokens.service.js';

export const IS_PUBLIC = 'yucampus:public';
/** Route metadata: the request passes when the person has any one of these. */
export const REQUIRED_ACCESS = 'yucampus:access';

export type AccessRule = { permission: Permission; scopes?: readonly Scope[] };

/** Route metadata: a platform route (YuCampus team). 'open' needs no token (sign-in); 'signed-in' needs a platform token. */
export const PLATFORM_ROUTE = 'yucampus:platform';
export type PlatformAccess = 'open' | 'signed-in';
/** A platform route: the college guards skip it and PlatformGuard checks a platform token instead. */
export const PlatformRoute = (access: PlatformAccess = 'signed-in') => SetMetadata(PLATFORM_ROUTE, access);

/** Every route needs a signed-in user unless it is marked @Public(). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Same rule the web sidebar uses for showing a section, so the two cannot disagree. */
export const RequireSection = (section: Section) => SetMetadata(REQUIRED_ACCESS, SECTION_ACCESS[section]);

/** Needs this permission, optionally only at these scopes (e.g. ['college']). */
export const RequirePermission = (permission: Permission, scopes?: readonly Scope[]) =>
  SetMetadata(REQUIRED_ACCESS, [{ permission, scopes }] satisfies AccessRule[]);

/** Needs any one of these permissions. */
export const RequireAnyPermission = (...rules: AccessRule[]) => SetMetadata(REQUIRED_ACCESS, rules);

/**
 * The verified user of the current request, with their permissions worked out.
 * Take `collegeId` from here, never from the request body.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  return context.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
