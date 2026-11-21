import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';

export const API_PREFIX = 'api';

/** Configuración compartida entre `main.ts` y los tests e2e (misma pipeline real). */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Matemática bajo reglas — API')
      .setDescription('API REST del juego educativo Matemática bajo reglas.')
      .setVersion('0.1.0')
      .addBearerAuth() // reservado: la autenticación JWT llegará con el módulo `auth`
      .build(),
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
}
