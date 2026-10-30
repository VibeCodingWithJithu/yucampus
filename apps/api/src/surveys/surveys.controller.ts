import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { type CreateSurveyInput, type SurveyAnswersInput, createSurveySchema, surveyAnswersSchema, surveyStatusSchema } from '@yucampus/validation';
import { z } from 'zod';
import { CurrentUser, Public } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { IdParam } from '../common/params.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { SurveysService } from './surveys.service.js';

@ApiTags('surveys')
@ApiBearerAuth()
@Controller('surveys')
export class SurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get('templates')
  @ApiOperation({ summary: 'Survey templates (rules data) and the reports each feeds' })
  templates() {
    return this.surveys.templates();
  }

  @Get()
  @ApiQuery({ name: 'course', required: false })
  @ApiOperation({ summary: 'Surveys the person runs (all for IQAC; course exit surveys for courses they manage)' })
  list(@CurrentUser() actor: AuthUser, @Query('course') course?: string) {
    return this.surveys.list(actor, course && z.uuid().safeParse(course).success ? course : undefined);
  }

  @Post()
  @ApiZodBody(createSurveySchema)
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(createSurveySchema)) body: CreateSurveyInput) {
    return this.surveys.create(actor, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A survey with its open link, results per question and written comments' })
  get(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.surveys.get(actor, id);
  }

  @Put(':id/status')
  @ApiZodBody(surveyStatusSchema)
  @ApiOperation({ summary: 'Open or close. Closing a course exit survey sets the COs’ indirect attainment.' })
  status(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(surveyStatusSchema)) body: { status: 'open' | 'closed' }) {
    return this.surveys.setStatus(actor, id, body.status);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.surveys.remove(actor, id);
  }
}

/** The open link: anyone with it can read the questions and answer once per device. No sign-in, no results. */
@ApiTags('surveys')
@Controller('public/surveys')
@Public()
export class PublicSurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.surveys.publicView(token);
  }

  @Post(':token/answers')
  @HttpCode(201)
  @ApiZodBody(surveyAnswersSchema)
  answer(@Param('token') token: string, @Body(new ZodPipe(surveyAnswersSchema)) body: SurveyAnswersInput) {
    return this.surveys.answer(token, body);
  }
}
