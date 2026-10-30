import { Global, Module } from '@nestjs/common';
import { AccreditationController } from './accreditation.controller.js';
import { AccreditationService } from './accreditation.service.js';

@Global()
@Module({
  controllers: [AccreditationController],
  providers: [AccreditationService],
  exports: [AccreditationService],
})
export class AccreditationModule {}
