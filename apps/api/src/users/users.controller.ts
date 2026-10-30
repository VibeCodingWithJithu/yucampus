import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type UserImportInput,
  type UserInputParsed,
  type UserListQuery,
  userImportSchema,
  userInputSchema,
  userListQuerySchema,
} from '@yucampus/validation';
import { CurrentUser, RequireSection } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { IdParam, ZodQuery } from '../common/params.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@RequireSection('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'People in the college, 20-50 per page, with counts by status' })
  list(@CurrentUser() actor: AuthUser, @ZodQuery(userListQuerySchema) query: UserListQuery) {
    return this.users.list(actor, query);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.users.get(actor, id);
  }

  @Post()
  @ApiZodBody(userInputSchema)
  @ApiOperation({ summary: 'Add (invite) a person. They become active the first time they sign in.' })
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(userInputSchema)) body: UserInputParsed) {
    return this.users.create(actor, body);
  }

  @Put(':id')
  @ApiZodBody(userInputSchema)
  update(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(userInputSchema)) body: UserInputParsed) {
    return this.users.update(actor, id, body);
  }

  @Post(':id/invite')
  @HttpCode(200)
  @ApiOperation({ summary: 'Email the invite again with a new link' })
  resendInvite(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.users.resendInvite(actor, id);
  }

  @Post('import')
  @HttpCode(200)
  @ApiZodBody(userImportSchema)
  @ApiOperation({ summary: 'Check (dryRun: true) or add people from spreadsheet rows. All or nothing.' })
  import(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(userImportSchema)) body: UserImportInput & { dryRun: boolean }) {
    return this.users.import(actor, body.rows, body.dryRun);
  }
}
