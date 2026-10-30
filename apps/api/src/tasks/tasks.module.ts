import { Module } from '@nestjs/common';
import { NotificationsController, TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  controllers: [TasksController, NotificationsController],
  providers: [TasksService],
})
export class TasksModule {}
