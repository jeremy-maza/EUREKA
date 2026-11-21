import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

describe('App (pipeline HTTP real, sin base de datos)', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: jest.fn(), $disconnect: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health responde ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });

  it('GET /api/health/ready responde ok si la base de datos responde', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('GET /api/health/ready responde 503 si la base de datos falla', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app.getHttpServer()).get('/api/health/ready').expect(503);
    expect(res.body).toMatchObject({ statusCode: 503, path: '/api/health/ready' });
  });

  it('las rutas inexistentes usan el formato de error centralizado', async () => {
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'NOT_FOUND', path: '/api/nope' });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('expone la documentación Swagger/OpenAPI', async () => {
    await request(app.getHttpServer()).get('/api/docs').expect(200);
    const json = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(json.body.openapi).toMatch(/^3\./);
    expect(Object.keys(json.body.paths)).toEqual(
      expect.arrayContaining(['/api/health', '/api/health/ready']),
    );
  });
});
