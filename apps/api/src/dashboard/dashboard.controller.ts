import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermission('dashboards.view', ['college', 'department'])
  @ApiQuery({ name: 'year', required: false, description: 'Academic year id; the current year when left out' })
  @ApiOperation({ summary: 'Principal dashboard: readiness, key numbers, deadlines, departments and recent activity' })
  view(@CurrentUser() actor: AuthUser, @Query('year') year?: string) {
    return this.dashboard.view(actor, year && z.uuid().safeParse(year).success ? year : undefined);
  }
}
