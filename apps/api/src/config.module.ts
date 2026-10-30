import { Global, Module } from '@nestjs/common';
import { AppConfig, loadConfig } from './config.js';

@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: () => loadConfig() }],
  exports: [AppConfig],
})
export class ConfigModule {}
