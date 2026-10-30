import { Module } from '@nestjs/common';
import { RegistersController } from './registers.controller.js';
import { RegistersService } from './registers.service.js';

@Module({
  controllers: [RegistersController],
  providers: [RegistersService],
})
export class RegistersModule {}
