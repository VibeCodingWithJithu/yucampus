import { Controller, Get, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type AuditQuery, auditQuerySchema } from '@yucampus/validation';
import type { Response } from 'express';
import { CurrentUser, RequireSection } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { ZodQuery } from '../common/params.js';
import { AuditLogService } from './audit-log.service.js';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
@RequireSection('audit')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'Who changed what and when, newest first, with filters (20-50 per page)' })
  list(@CurrentUser() actor: AuthUser, @ZodQuery(auditQuerySchema) query: AuditQuery) {
    return this.auditLog.list(actor, query);
  }

  @Get('csv')
  @ApiOperation({ summary: 'The filtered audit log as CSV (at most 5,000 rows)' })
  async csv(@CurrentUser() actor: AuthUser, @Res({ passthrough: true }) response: Response, @ZodQuery(auditQuerySchema) query: AuditQuery) {
    const file = await this.auditLog.csv(actor, query);
    response.setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader('content-disposition', `attachment; filename="audit-log.csv"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return new StreamableFile(file.body);
  }
}
