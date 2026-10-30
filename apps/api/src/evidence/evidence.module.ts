import { Module } from '@nestjs/common';
import { EvidenceController } from './evidence.controller.js';
import { EvidenceLibraryService } from './evidence-library.service.js';
import { EvidenceService } from './evidence.service.js';

@Module({
  controllers: [EvidenceController],
  providers: [EvidenceService, EvidenceLibraryService],
})
export class EvidenceModule {}
