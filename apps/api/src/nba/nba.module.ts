import { Module } from '@nestjs/common';
import { NbaController } from './nba.controller.js';
import { NbaService } from './nba.service.js';

@Module({
  controllers: [NbaController],
  providers: [NbaService],
})
export class NbaModule {}
