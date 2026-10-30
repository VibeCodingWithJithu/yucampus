import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PermissionAdjustment } from '@yucampus/types';
import { permissionChangeSchema } from '@yucampus/validation';
import { CurrentUser, RequireAnyPermission } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { PermissionsService } from './permissions.service.js';

@ApiTags('permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  @RequireAnyPermission({ permission: 'users_setup.manage' }, { permission: 'permissions.manage' }, { permission: 'iqac_setup.grant' })
  @ApiOperation({ summary: 'What each role can do in this college, and which entries the caller may change' })
  matrix(@CurrentUser() actor: AuthUser) {
    return this.permissions.matrix(actor);
  }

  @Put()
  @RequireAnyPermission({ permission: 'permissions.manage' }, { permission: 'iqac_setup.grant' })
  @ApiZodBody(permissionChangeSchema)
  @ApiOperation({ summary: 'Switch one permission on or off for one role in this college' })
  update(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(permissionChangeSchema)) body: PermissionAdjustment) {
    return this.permissions.update(actor, body);
  }
}
