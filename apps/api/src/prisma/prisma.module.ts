import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config.js';
import { openDatabase } from './database.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      inject: [AppConfig],
      useFactory: async (config: AppConfig) => new PrismaService(await openDatabase(config.databaseUrl)),
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
