import { Body, Controller, Delete, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  type AssessmentResultsInput,
  type AttainmentRulesInput,
  type CoPoMappingInput,
  type CourseInput,
  type CourseOutcomesInput,
  type ProgramProfileInput,
  type PsosInput,
  assessmentResultsSchema,
  programProfileSchema,
  attainmentRulesSchema,
  coPoMappingSchema,
  courseInputSchema,
  courseOutcomesSchema,
  psosSchema,
} from '@yucampus/validation';
import { z } from 'zod';
import { CurrentUser, RequireSection } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { IdParam } from '../common/params.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { NbaService } from './nba.service.js';

const lockSchema = z.object({ locked: z.boolean() });
const optionalYear = (year?: string) => (year && z.uuid().safeParse(year).success ? year : undefined);

@ApiTags('nba')
@ApiBearerAuth()
@Controller('nba')
@RequireSection('nba')
export class NbaController {
  constructor(private readonly nba: NbaService) {}

  @Get('programs')
  @ApiOperation({ summary: 'Programs the person can open (with their NBA format)' })
  programs(@CurrentUser() actor: AuthUser) {
    return this.nba.programs(actor);
  }

  @Get('programs/:id')
  @ApiQuery({ name: 'year', required: false })
  @ApiOperation({ summary: "A program's outcomes, attainment rules, courses of the year and PO attainment" })
  program(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Query('year') year?: string) {
    return this.nba.programView(actor, id, optionalYear(year));
  }

  @Put('programs/:id/rules')
  @ApiZodBody(attainmentRulesSchema)
  rules(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(attainmentRulesSchema)) body: AttainmentRulesInput) {
    return this.nba.setRules(actor, id, body);
  }

  @Put('programs/:id/profile')
  @ApiZodBody(programProfileSchema)
  @ApiOperation({ summary: 'Vision, mission and PEOs (SAR criterion 1)' })
  profile(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(programProfileSchema)) body: ProgramProfileInput) {
    return this.nba.setProfile(actor, id, body);
  }

  @Put('programs/:id/psos')
  @ApiZodBody(psosSchema)
  psos(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(psosSchema)) body: PsosInput) {
    return this.nba.setPsos(actor, id, body);
  }

  @Post('programs/:id/courses')
  @ApiZodBody(courseInputSchema)
  createCourse(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(courseInputSchema)) body: CourseInput) {
    return this.nba.createCourse(actor, id, body);
  }

  @Get('courses/:id')
  @ApiOperation({ summary: 'A course: COs, CO–PO mapping, results and attainment worked out step by step' })
  course(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.nba.course(actor, id);
  }

  @Put('courses/:id')
  @ApiZodBody(courseInputSchema)
  updateCourse(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(courseInputSchema)) body: CourseInput) {
    return this.nba.updateCourse(actor, id, body);
  }

  @Delete('courses/:id')
  @HttpCode(204)
  removeCourse(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.nba.removeCourse(actor, id);
  }

  @Put('courses/:id/outcomes')
  @ApiZodBody(courseOutcomesSchema)
  outcomes(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(courseOutcomesSchema)) body: CourseOutcomesInput) {
    return this.nba.setOutcomes(actor, id, body);
  }

  @Put('courses/:id/mapping')
  @ApiZodBody(coPoMappingSchema)
  mapping(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(coPoMappingSchema)) body: CoPoMappingInput) {
    return this.nba.setMapping(actor, id, body);
  }

  @Put('courses/:id/results')
  @ApiZodBody(assessmentResultsSchema)
  @ApiOperation({ summary: 'CO totals per assessment: students who attempted and who reached the target mark' })
  results(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(assessmentResultsSchema)) body: AssessmentResultsInput) {
    return this.nba.setResults(actor, id, body);
  }

  @Put('courses/:id/lock')
  @ApiZodBody(lockSchema)
  lock(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(lockSchema)) body: { locked: boolean }) {
    return this.nba.setLocked(actor, id, body.locked);
  }
}
