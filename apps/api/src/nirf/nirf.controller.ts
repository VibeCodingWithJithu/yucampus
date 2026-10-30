import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, RequireSection } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { NirfService } from './nirf.service.js';

const categoryOf = (value?: string) => (value && /^NIRF_[A-Z_]{2,30}$/.test(value) ? value : undefined);

@ApiTags('nirf')
@ApiBearerAuth()
@Controller('nirf')
@RequireSection('nirf')
export class NirfController {
  constructor(private readonly nirf: NirfService) {}

  @Get()
  @ApiQuery({ name: 'category', required: false, description: 'e.g. NIRF_ENGINEERING' })
  @ApiOperation({ summary: 'NIRF data readiness for a category: completeness and the numbers from the registers (no score)' })
  view(@CurrentUser() actor: AuthUser, @Query('category') category?: string) {
    return this.nirf.view(actor, categoryOf(category));
  }

  @Get('sheet')
  @ApiQuery({ name: 'category', required: false })
  @ApiOperation({ summary: 'The NIRF data sheets as an Excel workbook' })
  async sheet(@CurrentUser() actor: AuthUser, @Res({ passthrough: true }) response: Response, @Query('category') category?: string) {
    const file = await this.nirf.sheet(actor, categoryOf(category));
    response.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('content-disposition', `attachment; filename="nirf.xlsx"; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return new StreamableFile(file.body);
  }
}
