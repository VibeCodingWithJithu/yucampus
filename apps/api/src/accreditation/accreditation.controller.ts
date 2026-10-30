import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ACCREDITATION_BODIES, type AccreditationBody } from '@yucampus/types';
import { type CommentInput, commentSchema } from '@yucampus/validation';
import { z } from 'zod';
import { CurrentUser, RequireAnyPermission } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { apiError } from '../common/api-error.js';
import { IdParam } from '../common/params.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { AccreditationService } from './accreditation.service.js';

const bodySchema = z.enum(ACCREDITATION_BODIES, 'Unknown accreditation body');

// Readiness is for people who see college or department dashboards, and for anyone who reports for a body.
const CanSeeReadiness = () =>
  RequireAnyPermission(
    { permission: 'dashboards.view', scopes: ['college', 'department'] },
    { permission: 'reports.generate' },
    { permission: 'evidence.approve_final' },
  );

@ApiTags('accreditation')
@ApiBearerAuth()
@Controller()
export class AccreditationController {
  constructor(private readonly accreditation: AccreditationService) {}

  @Get('accreditation/:body/overview')
  @CanSeeReadiness()
  @ApiQuery({ name: 'framework', required: false })
  @ApiOperation({ summary: 'Readiness by criterion for NAAC / NIRF / AISHE, from finally approved evidence only' })
  async overview(
    @CurrentUser() actor: AuthUser,
    @Param('body', new ZodPipe(bodySchema)) body: AccreditationBody,
    @Query('framework') framework?: string,
  ) {
    const result = await this.accreditation.overview(actor, body, framework && z.uuid().safeParse(framework).success ? framework : undefined);
    if (!result) throw apiError(404, 'no_framework', `Your college has not chosen a ${body} framework yet. Choose one in Institution setup.`);
    return result;
  }

  @Get('frameworks/:id/criteria/:number')
  @CanSeeReadiness()
  @ApiOperation({ summary: 'One criterion with its metrics and their readiness' })
  criterion(
    @CurrentUser() actor: AuthUser,
    @IdParam() id: string,
    @Param('number', new ZodPipe(z.coerce.number().int().min(1).max(20))) number: number,
  ) {
    return this.accreditation.criterion(actor, id, number);
  }

  @Get('metrics/linkable')
  @ApiOperation({ summary: 'Metrics evidence can be linked to (frameworks the college works against now)' })
  linkable(@CurrentUser() actor: AuthUser) {
    return this.accreditation.linkableMetrics(actor);
  }

  @Get('metrics/:id')
  @CanSeeReadiness()
  metric(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.accreditation.metric(actor, id);
  }

  @Post('metrics/:id/comments')
  @CanSeeReadiness()
  @ApiZodBody(commentSchema)
  comment(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(commentSchema)) body: CommentInput) {
    return this.accreditation.addComment(actor, id, body.body);
  }
}
