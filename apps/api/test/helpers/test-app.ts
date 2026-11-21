import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/common';
import { configureApp } from '../../src/common/configure-app';
import { UserRole } from '../../src/generated/prisma/client';
import { PasswordHasher } from '../../src/modules/auth/password-hasher';
import { arithmeticWorld, syncWorldCatalog, WorldsRepository } from '../../src/modules/worlds';
import { PrismaService } from '../../src/prisma/prisma.service';
import { FakeClock } from './fake-clock';

export const PASSWORD = 'correct-horse-battery';

export interface TestContext {
  app: INestApplication;
  clock: FakeClock;
  prisma: PrismaService;
  /** Borra los datos de jugadores (no el catálogo) y reinicia el reloj. */
  reset(): Promise<void>;
  close(): Promise<void>;
  http(): ReturnType<typeof request>;
}

/** Aplicación Nest COMPLETA (guards, pipes, filtros, Swagger) contra PostgreSQL real y con reloj controlable. */
export async function createTestApp(): Promise<TestContext> {
  const clock = new FakeClock();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  await syncWorldCatalog(prisma, [arithmeticWorld]);

  return {
    app,
    clock,
    prisma,
    http: () => request(app.getHttpServer()),
    async reset() {
      await prisma.$executeRawUnsafe('TRUNCATE TABLE users, groups CASCADE');
      app.get(WorldsRepository).clearCache();
      clock.advanceMs(0);
    },
    close: () => app.close(),
  };
}

/** Cliente de un jugador autenticado, con helpers del flujo de juego. */
export class Player {
  private constructor(
    private readonly ctx: TestContext,
    readonly token: string,
    readonly userId: string,
  ) {}

  static async register(
    ctx: TestContext,
    email: string,
    role: UserRole = UserRole.STUDENT,
    displayName?: string,
  ): Promise<Player> {
    let userId: string;
    if (role === UserRole.STUDENT) {
      const res = await ctx
        .http()
        .post('/api/auth/register')
        .send({ email, displayName: displayName ?? 'Jugador', password: PASSWORD })
        .expect(201);
      userId = res.body.id;
    } else {
      // Docentes/administradores no se autorregistran: se crean por vía administrativa (aquí, directo en BD).
      const user = await ctx.prisma.user.create({
        data: {
          email,
          displayName: displayName ?? (role === UserRole.ADMIN ? 'Admin' : 'Docente'),
          passwordHash: await new PasswordHasher().hash(PASSWORD),
          role,
        },
      });
      userId = user.id;
    }
    const login = await ctx.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return new Player(ctx, login.body.accessToken, userId);
  }

  get = (path: string) => this.ctx.http().get(`/api${path}`).set('Authorization', `Bearer ${this.token}`);
  post = (path: string) => this.ctx.http().post(`/api${path}`).set('Authorization', `Bearer ${this.token}`);
  patch = (path: string) => this.ctx.http().patch(`/api${path}`).set('Authorization', `Bearer ${this.token}`);
  delete = (path: string) =>
    this.ctx.http().delete(`/api${path}`).set('Authorization', `Bearer ${this.token}`);

  startSession(world = 'arithmetic') {
    return this.post(`/worlds/${world}/sessions`);
  }

  startAttempt(sessionId: string) {
    return this.post(`/sessions/${sessionId}/attempts`);
  }

  answer(attemptId: string, expression: string) {
    return this.post(`/attempts/${attemptId}/answer`).send({ expression });
  }

  /** Abre sesión + reto actual y responde, devolviendo ambos cuerpos. */
  async play(sessionId: string, expression: string, secondsBeforeAnswering = 5) {
    const started = await this.startAttempt(sessionId);
    this.ctx.clock.advanceSeconds(secondsBeforeAnswering);
    const answered = await this.answer(started.body.attemptId, expression);
    return { started: started.body, answered: answered.body, status: answered.status };
  }
}
