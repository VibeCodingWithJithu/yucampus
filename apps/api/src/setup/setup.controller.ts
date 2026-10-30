import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AcademicYearDatesInput,
  type CollegeFrameworksInput,
  type CreateDepartmentInput,
  type CycleInput,
  type InstitutionProfileValues,
  type KeyDateInput,
  type ProgramFrameworkInput,
  type ProgramInput,
  type SsoSettingsValues,
  type UpdateDepartmentInput,
  academicYearDatesSchema,
  collegeFrameworksSchema,
  createDepartmentSchema,
  cycleSchema,
  institutionProfileSchema,
  keyDateSchema,
  programFrameworkSchema,
  programSchema,
  ssoSettingsSchema,
  updateDepartmentSchema,
} from '@yucampus/validation';
import { CurrentUser, RequireSection } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { IdParam } from '../common/params.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { AcademicYearsService } from './academic-years.service.js';
import { DepartmentsService } from './departments.service.js';
import { InstitutionService } from './institution.service.js';

// Reading departments and years is open to every signed-in person (they fill dropdowns everywhere).
// Changing anything needs "Manage users and setup" for the whole college (the setup section).

@ApiTags('institution')
@ApiBearerAuth()
@Controller('institution')
@RequireSection('setup')
export class InstitutionController {
  constructor(private readonly institution: InstitutionService) {}

  @Get('profile')
  getProfile(@CurrentUser() actor: AuthUser) {
    return this.institution.getProfile(actor);
  }

  @Put('profile')
  @ApiZodBody(institutionProfileSchema)
  updateProfile(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(institutionProfileSchema)) body: InstitutionProfileValues,
  ) {
    return this.institution.updateProfile(actor, body);
  }

  @Get('sso')
  @ApiOperation({ summary: 'Sign-in with Google or Microsoft: on or off, and the email domains allowed' })
  getSso(@CurrentUser() actor: AuthUser) {
    return this.institution.getSso(actor);
  }

  @Put('sso')
  @ApiZodBody(ssoSettingsSchema)
  updateSso(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(ssoSettingsSchema)) body: SsoSettingsValues) {
    return this.institution.updateSso(actor, body);
  }

  @Get('frameworks')
  @ApiOperation({ summary: 'Frameworks the college can work against, and which ones it has chosen' })
  listFrameworks(@CurrentUser() actor: AuthUser) {
    return this.institution.listFrameworks(actor);
  }

  @Put('frameworks')
  @ApiZodBody(collegeFrameworksSchema)
  @ApiOperation({ summary: 'Set which frameworks of one body are active (in one assessment cycle)' })
  setFrameworks(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodPipe(collegeFrameworksSchema)) body: CollegeFrameworksInput,
  ) {
    return this.institution.setCollegeFrameworks(actor, body);
  }

  @Post('cycles')
  @ApiZodBody(cycleSchema)
  @ApiOperation({ summary: 'Add an assessment cycle, e.g. "NAAC cycle 3"' })
  addCycle(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(cycleSchema)) body: CycleInput) {
    return this.institution.addCycle(actor, body);
  }

  @Get('setup-progress')
  @ApiOperation({ summary: 'The five onboarding steps and how far the college has got' })
  progress(@CurrentUser() actor: AuthUser) {
    return this.institution.progress(actor);
  }
}

@ApiTags('departments')
@ApiBearerAuth()
@Controller()
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get('departments')
  list(@CurrentUser() actor: AuthUser) {
    return this.departments.list(actor);
  }

  @Post('departments')
  @RequireSection('setup')
  @ApiZodBody(createDepartmentSchema)
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(createDepartmentSchema)) body: CreateDepartmentInput & { code: string }) {
    return this.departments.create(actor, body);
  }

  @Put('departments/:id')
  @RequireSection('setup')
  @ApiZodBody(updateDepartmentSchema)
  update(
    @CurrentUser() actor: AuthUser,
    @IdParam() id: string,
    @Body(new ZodPipe(updateDepartmentSchema)) body: UpdateDepartmentInput,
  ) {
    return this.departments.update(actor, id, body);
  }

  @Delete('departments/:id')
  @HttpCode(204)
  @RequireSection('setup')
  remove(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.departments.remove(actor, id);
  }

  @Post('departments/:id/programs')
  @RequireSection('setup')
  @ApiZodBody(programSchema)
  addProgram(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(programSchema)) body: ProgramInput) {
    return this.departments.addProgram(actor, id, body);
  }

  @Put('programs/:id')
  @RequireSection('setup')
  @ApiZodBody(programSchema)
  updateProgram(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(programSchema)) body: ProgramInput) {
    return this.departments.updateProgram(actor, id, body);
  }

  @Put('programs/:id/framework')
  @RequireSection('setup')
  @ApiZodBody(programFrameworkSchema)
  @ApiOperation({ summary: 'Set the framework (e.g. NBA Tier II) a program is assessed against' })
  setProgramFramework(
    @CurrentUser() actor: AuthUser,
    @IdParam() id: string,
    @Body(new ZodPipe(programFrameworkSchema)) body: ProgramFrameworkInput,
  ) {
    return this.departments.setProgramFramework(actor, id, body);
  }

  @Delete('programs/:id')
  @HttpCode(204)
  @RequireSection('setup')
  removeProgram(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.departments.removeProgram(actor, id);
  }
}

@ApiTags('academic years')
@ApiBearerAuth()
@Controller()
export class AcademicYearsController {
  constructor(private readonly years: AcademicYearsService) {}

  @Get('academic-years')
  list(@CurrentUser() actor: AuthUser) {
    return this.years.list(actor);
  }

  @Put('academic-years/:id')
  @RequireSection('setup')
  @ApiZodBody(academicYearDatesSchema)
  updateDates(
    @CurrentUser() actor: AuthUser,
    @IdParam() id: string,
    @Body(new ZodPipe(academicYearDatesSchema)) body: AcademicYearDatesInput,
  ) {
    return this.years.updateDates(actor, id, body);
  }

  @Post('academic-years/start-next')
  @HttpCode(200)
  @RequireSection('setup')
  @ApiOperation({ summary: 'Lock the current year and make the next one current' })
  startNext(@CurrentUser() actor: AuthUser) {
    return this.years.startNextYear(actor);
  }

  @Post('academic-years/:id/key-dates')
  @RequireSection('setup')
  @ApiZodBody(keyDateSchema)
  addKeyDate(
    @CurrentUser() actor: AuthUser,
    @IdParam() id: string,
    @Body(new ZodPipe(keyDateSchema)) body: KeyDateInput & { remindDaysBefore: number },
  ) {
    return this.years.addKeyDate(actor, id, body);
  }

  @Put('key-dates/:id')
  @RequireSection('setup')
  @ApiZodBody(keyDateSchema)
  updateKeyDate(
    @CurrentUser() actor: AuthUser,
    @IdParam() id: string,
    @Body(new ZodPipe(keyDateSchema)) body: KeyDateInput & { remindDaysBefore: number },
  ) {
    return this.years.updateKeyDate(actor, id, body);
  }

  @Delete('key-dates/:id')
  @HttpCode(204)
  @RequireSection('setup')
  removeKeyDate(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.years.removeKeyDate(actor, id);
  }
}
