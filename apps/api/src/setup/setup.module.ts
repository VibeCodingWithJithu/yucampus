import { Module } from '@nestjs/common';
import { AcademicYearsService } from './academic-years.service.js';
import { DepartmentsService } from './departments.service.js';
import { InstitutionService } from './institution.service.js';
import { AcademicYearsController, DepartmentsController, InstitutionController } from './setup.controller.js';

@Module({
  controllers: [InstitutionController, DepartmentsController, AcademicYearsController],
  providers: [InstitutionService, DepartmentsService, AcademicYearsService],
})
export class SetupModule {}
