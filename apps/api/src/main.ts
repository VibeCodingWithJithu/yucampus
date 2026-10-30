import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AppConfig } from './config.js';
import { SAMPLE_PASSWORD, SAMPLE_USERS } from './prisma/seed-data.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfig);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  // credentials: the refresh token lives in an httpOnly cookie.
  app.enableCors({ origin: config.webOrigin, credentials: true });
  app.enableShutdownHooks();

  const openApi = new DocumentBuilder()
    .setTitle('YuCampus API')
    .setDescription('REST API for YuCampus. Every tenant route is scoped to the college of the signed-in user.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  // UI at /docs, contract at /docs-json.
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openApi));

  await app.listen(config.port);

  // Sent by scripts/dev.mjs before a restart: close cleanly so the local database is never cut off mid-write.
  process.on('message', (message) => {
    if (message === 'shutdown') void app.close().then(() => process.exit(0));
  });

  if (config.databaseUrl.startsWith('pglite:')) {
    new Logger('Local').warn(
      `Using the built-in local database (no Docker). Sample sign-in: ${SAMPLE_USERS[0]?.email} / ${SAMPLE_PASSWORD}`,
    );
  }
}

void bootstrap();
