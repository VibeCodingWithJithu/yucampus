import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FileStorage } from '../storage/file-storage.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: FileStorage,
  ) {}

  @Public()
  @Get()
  @ApiOkResponse({ description: 'The API is running. `database` and `storage` say whether they can be reached.' })
  async check() {
    const [database, storage] = await Promise.all([this.prisma.isReachable(), this.storage.isReachable()]);
    return { status: 'ok', database: database ? 'up' : 'down', storage: storage ? 'up' : 'off' };
  }
}
