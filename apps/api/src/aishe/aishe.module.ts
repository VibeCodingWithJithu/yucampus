import { Module } from '@nestjs/common';
import { AisheController } from './aishe.controller.js';
import { AisheService } from './aishe.service.js';

@Module({
  controllers: [AisheController],
  providers: [AisheService],
})
export class AisheModule {}
