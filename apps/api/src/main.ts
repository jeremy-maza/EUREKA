import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './common/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.enableCors({ origin: config.get<string>('CORS_ORIGIN') });
  app.enableShutdownHooks();
  configureApp(app);

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(
    `API lista en http://localhost:${port}/${API_PREFIX} — docs en /${API_PREFIX}/docs`,
    'Bootstrap',
  );
}

void bootstrap();
