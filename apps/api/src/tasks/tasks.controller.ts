import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type GapTasksInput,
  type NotificationPreferencesInput,
  type NotificationsQuery,
  type TaskValues,
  gapTasksSchema,
  notificationPreferencesSchema,
  notificationsQuerySchema,
  taskInputSchema,
} from '@yucampus/validation';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import type { AuthUser } from '../auth/tokens.service.js';
import { IdParam, ZodQuery } from '../common/params.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TasksService } from './tasks.service.js';

const doneSchema = z.object({ done: z.boolean() });
const markReadSchema = z.object({ ids: z.array(z.uuid()).max(200).nullish() });

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'The tasks the person may see, with their stage worked out from evidence' })
  board(@CurrentUser() actor: AuthUser) {
    return this.tasks.board(actor);
  }

  @Get('assignees')
  @ApiOperation({ summary: 'Departments and people I may give tasks to' })
  assignees(@CurrentUser() actor: AuthUser) {
    return this.tasks.assignees(actor);
  }

  @Post()
  @RequirePermission('tasks.assign')
  @ApiZodBody(taskInputSchema)
  @ApiOperation({ summary: 'Create a task and notify the people it is for' })
  create(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(taskInputSchema)) body: TaskValues) {
    return this.tasks.create(actor, body);
  }

  @Post('from-gaps')
  @RequirePermission('tasks.assign')
  @ApiZodBody(gapTasksSchema)
  @ApiOperation({ summary: 'One task per required document still missing in a criterion (or all criteria)' })
  fromGaps(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(gapTasksSchema)) body: GapTasksInput) {
    return this.tasks.fromGaps(actor, body);
  }

  @Post('remind-overdue')
  @HttpCode(200)
  @RequirePermission('tasks.assign')
  @ApiOperation({ summary: 'Remind the people behind every overdue task I manage, today' })
  remindOverdue(@CurrentUser() actor: AuthUser) {
    return this.tasks.remindOverdue(actor);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.tasks.get(actor, id);
  }

  @Put(':id')
  @RequirePermission('tasks.assign')
  @ApiZodBody(taskInputSchema)
  update(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(taskInputSchema)) body: TaskValues) {
    return this.tasks.update(actor, id, body);
  }

  @Put(':id/done')
  @RequirePermission('tasks.assign')
  @ApiZodBody(doneSchema)
  setDone(@CurrentUser() actor: AuthUser, @IdParam() id: string, @Body(new ZodPipe(doneSchema)) body: { done: boolean }) {
    return this.tasks.setDone(actor, id, body.done);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('tasks.assign')
  remove(@CurrentUser() actor: AuthUser, @IdParam() id: string) {
    return this.tasks.remove(actor, id);
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @ZodQuery(notificationsQuerySchema) query: NotificationsQuery) {
    return this.notifications.list(actor, query);
  }

  @Get('unread-count')
  unread(@CurrentUser() actor: AuthUser) {
    return this.notifications.unreadCount(actor);
  }

  @Post('read')
  @HttpCode(200)
  @ApiZodBody(markReadSchema)
  @ApiOperation({ summary: 'Mark some (ids) or all of my notifications as read' })
  markRead(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(markReadSchema)) body: { ids?: string[] | null }) {
    return this.notifications.markRead(actor, body.ids ?? undefined);
  }

  @Get('preferences')
  preferences(@CurrentUser() actor: AuthUser) {
    return this.notifications.preferences(actor);
  }

  @Put('preferences')
  @ApiZodBody(notificationPreferencesSchema)
  setPreferences(@CurrentUser() actor: AuthUser, @Body(new ZodPipe(notificationPreferencesSchema)) body: NotificationPreferencesInput) {
    return this.notifications.setPreferences(actor, body);
  }
}
