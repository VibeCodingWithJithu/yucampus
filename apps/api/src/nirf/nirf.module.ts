import { Module } from '@nestjs/common';
import { NirfController } from './nirf.controller.js';
import { NirfService } from './nirf.service.js';

@Module({
  controllers: [NirfController],
  providers: [NirfService],
})
export class NirfModule {}
