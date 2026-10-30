import { Body, Controller, Get, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type SubmittedFigureInput, submittedFigureSchema } from '@yucampus/validation';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequireSection } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { AisheService } from './aishe.service.js';

const yearOf = (value?: string) => (value && z.uuid().safeParse(value).success ? value : undefined);

@ApiTags('aishe')
@ApiBearerAuth()
@Controller('aishe')
@RequireSection('aishe')
export class AisheController {
  constructor(private readonly aishe: AisheService) {}

  @Get()
  @ApiQuery({ name: 'year', required: false, description: 'Academic year id; by default the latest locked year' })
  @ApiOperation({ summary: 'AISHE data forms for a survey year from the registers, with the consistency checker' })
  view(@CurrentUser() actor: AuthUser, @Query('year') year?: string) {
    return this.aishe.view(actor, yearOf(year));
  }

  @Put('figures')
  @ApiZodBody(submittedFigureSchema)
  @ApiOperation({ summary: 'Record what was submitted to AISHE, NIRF or NAAC for one figure (a null value removes it)' })
  setFigure(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(submittedFigureSchema)) body: SubmittedFigureInput) {
    return this.aishe.setFigure(actor, body);
  }

  @Get('sheet')
  @ApiQuery({ name: 'year', required: false })
  @ApiOperation({ summary: 'The AISHE data forms as an Excel workbook' })
  async sheet(@CurrentUser() actor: AuthUser, @Res({ passthrough: true }) response: Response, @Query('year') year?: string) {
    const file = await this.aishe.sheet(actor, yearOf(year));
    response.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('content-disposition', `attachment; filename="aishe.xlsx"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return new StreamableFile(file.body);
  }
}
