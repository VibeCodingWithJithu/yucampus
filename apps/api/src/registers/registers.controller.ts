import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  type RegisterImportInput,
  type RegisterQuery,
  type RegisterRecordInput,
  registerImportSchema,
  registerQuerySchema,
  registerRecordSchema,
} from '@yucampus/validation';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequireSection } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { IdParam, ZodQuery } from '../common/params.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { RegistersService } from './registers.service.js';

const codeParam = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{1,39}$/);
const copySchema = z.object({ toYearId: z.uuid() });

@ApiTags('registers')
@ApiBearerAuth()
@Controller('registers')
@RequireSection('registers')
export class RegistersController {
  constructor(private readonly registers: RegistersService) {}

  @Get()
  @ApiQuery({ name: 'year', required: false })
  @ApiOperation({ summary: 'The registers with record counts for an academic year (the current one by default)' })
  list(@CurrentUser() actor: AuthUser, @Query('year') year?: string) {
    return this.registers.list(actor, year && z.uuid().safeParse(year).success ? year : undefined);
  }

  @Get('records/:id')
  record(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.registers.record(actor, id);
  }

  @Put('records/:id')
  @ApiZodBody(registerRecordSchema)
  update(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(registerRecordSchema)) body: RegisterRecordInput) {
    return this.registers.update(actor, id, body);
  }

  @Delete('records/:id')
  @HttpCode(204)
  remove(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.registers.remove(actor, id);
  }

  @Get(':code')
  @ApiOperation({ summary: "One register's records for a year, with its fields, missing values and who may edit what" })
  page(@CurrentUser() actor: AuthUser, @Param('code', new ZodPipe(codeParam)) code: string, @ZodQuery(registerQuerySchema) query: RegisterQuery) {
    return this.registers.page(actor, code, query);
  }

  @Post(':code/records')
  @ApiZodBody(registerRecordSchema)
  create(@CurrentUser() actor: AuthUser, @Param('code', new ZodPipe(codeParam)) code: string, @Body(new ZodPipe(registerRecordSchema)) body: RegisterRecordInput) {
    return this.registers.create(actor, code, body);
  }

  @Post(':code/import')
  @HttpCode(200)
  @ApiZodBody(registerImportSchema)
  @ApiOperation({ summary: 'Check (dryRun: true) or add rows from a spreadsheet. All or nothing.' })
  import(@CurrentUser() actor: AuthUser, @Param('code', new ZodPipe(codeParam)) code: string, @Body(new ZodPipe(registerImportSchema)) body: RegisterImportInput) {
    return this.registers.import(actor, code, body);
  }

  @Post(':code/copy')
  @HttpCode(200)
  @ApiZodBody(copySchema)
  @ApiOperation({ summary: "Copy the previous year's records into an empty year" })
  copy(@CurrentUser() actor: AuthUser, @Param('code', new ZodPipe(codeParam)) code: string, @Body(new ZodPipe(copySchema)) body: { toYearId: string }) {
    return this.registers.copy(actor, code, body.toYearId);
  }

  @Get(':code/sheet')
  @ApiOperation({ summary: 'A blank Excel sheet with the columns to fill in for an import' })
  async sheet(@CurrentUser() actor: AuthUser, @Param('code', new ZodPipe(codeParam)) code: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.registers.sheet(actor, code);
    response.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('content-disposition', `attachment; filename="register.xlsx"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return new StreamableFile(file.body);
  }
}
