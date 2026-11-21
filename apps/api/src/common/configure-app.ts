import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Application } from 'express';
import { parseTrustProxy } from '../config/auth.config';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';

export const API_PREFIX = 'api';

/** Configuración compartida entre `main.ts` y los tests e2e (misma pipeline real). */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  // `request.ip` (clave del limitador y de las sesiones) solo confía en `X-Forwarded-For` si TRUST_PROXY lo indica.
  const express = app.getHttpAdapter().getInstance() as Application;
  express.set('trust proxy', parseTrustProxy(app.get(ConfigService).get<string>('TRUST_PROXY')));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Matemática bajo reglas — API')
      .setDescription('API REST del juego educativo Matemática bajo reglas.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
}
