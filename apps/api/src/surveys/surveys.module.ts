import { Module } from '@nestjs/common';
import { PublicSurveysController, SurveysController } from './surveys.controller.js';
import { SurveysService } from './surveys.service.js';

@Module({
  controllers: [SurveysController, PublicSurveysController],
  providers: [SurveysService],
})
export class SurveysModule {}
