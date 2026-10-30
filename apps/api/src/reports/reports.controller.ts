import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type CreateExportInput, type ReportChecksQuery, createExportSchema, reportChecksQuerySchema } from '@yucampus/validation';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { IdParam, ZodQuery } from '../common/params.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { ReportsService } from './reports.service.js';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@RequirePermission('reports.generate')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('templates')
  @ApiOperation({ summary: 'Reports the college can create now (from the frameworks it works against)' })
  templates(@CurrentUser() actor: AuthUser) {
    return this.reports.templates(actor);
  }

  @Get('checks')
  @ApiOperation({ summary: 'Fix before export: gaps and things to check for a report and period' })
  checks(@CurrentUser() actor: AuthUser, @ZodQuery(reportChecksQuerySchema) query: ReportChecksQuery) {
    return this.reports.checks(actor, query.template, query.year, query.program);
  }

  @Get('exports')
  @ApiOperation({ summary: 'Export history (the latest 30)' })
  list(@CurrentUser() actor: AuthUser) {
    return this.reports.list(actor);
  }

  @Post('exports')
  @ApiZodBody(createExportSchema)
  @ApiOperation({ summary: 'Start creating files; poll GET /reports/exports/:id until it is done' })
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(createExportSchema)) body: CreateExportInput) {
    return this.reports.create(actor, body);
  }

  @Get('exports/:id')
  get(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.reports.get(actor, id);
  }

  @Get('exports/:id/files/:index')
  @ApiOperation({ summary: 'A short-lived download link for one file of an export' })
  download(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Param('index', ParseIntPipe) index: number) {
    return this.reports.download(actor, id, index);
  }
}
