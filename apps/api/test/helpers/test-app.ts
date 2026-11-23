import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Clock, SeedSource, SequentialSeedSource } from '../../src/common';
import { configureApp } from '../../src/common/configure-app';
import { UserRole } from '../../src/generated/prisma/client';
import { PasswordHasher } from '../../src/modules/auth/password-hasher';
import { Mailer } from '../../src/modules/mail';
import { PasswordService } from '../../src/modules/auth/password.service';
import { DIFFICULTY_POLICY, SEQUENCE_PLANNER } from '../../src/modules/game/sequence-store';
import { DifficultyPolicy, adaptiveDifficultyPolicy } from '../../src/modules/game/difficulty';
import { ALL_WORLDS, syncWorldCatalog, WorldsRepository } from '../../src/modules/worlds';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CapturingMailer } from './capturing-mailer';
import { FakeClock } from './fake-clock';
import { PlannerMode, testPlanner } from './scripted-planner';

export const PASSWORD = 'correct-horse-battery';

export interface TestAppOptions {
  /**
   * `classic-arithmetic` (por defecto): el Mundo 1 juega siempre la secuencia clásica (valores exactos conocidos)
   * y el resto de mundos usa el planificador real. `real`: planificador real en todos.
   */
  planner?: PlannerMode;
  /** Política de dificultad (por defecto la adaptativa real). */
  difficulty?: DifficultyPolicy;
}

export interface TestContext {
  app: INestApplication;
  clock: FakeClock;
  seeds: SequentialSeedSource;
  mailer: CapturingMailer;
  prisma: PrismaService;
  /** Borra los datos de jugadores (no el catálogo) y reinicia el reloj. */
  reset(): Promise<void>;
  close(): Promise<void>;
  http(): ReturnType<typeof request>;
}

/** Aplicación Nest COMPLETA (guards, pipes, filtros, Swagger) contra PostgreSQL real y con reloj controlable. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const clock = new FakeClock();
  const mailer = new CapturingMailer();
  let seeds = new SequentialSeedSource(1);
  // Semillas deterministas que se reinician con `reset()` (el proveedor delega en la instancia vigente).
  const seedSource: SeedSource = { next: () => seeds.next() };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(SeedSource)
    .useValue(seedSource)
    .overrideProvider(SEQUENCE_PLANNER)
    .useValue(testPlanner(options.planner ?? 'classic-arithmetic'))
    .overrideProvider(DIFFICULTY_POLICY)
    .useValue(options.difficulty ?? adaptiveDifficultyPolicy)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  await syncWorldCatalog(prisma, ALL_WORLDS);

  return {
    app,
    clock,
    get seeds() {
      return seeds;
    },
    mailer,
    prisma,
    http: () => request(app.getHttpServer()),
    async reset() {
      // Espera a los correos en segundo plano para que no cuenten en la prueba siguiente.
      await app.get(PasswordService).drainPendingMail();
      mailer.clear();
      // `users` arrastra (CASCADE) sesiones y tokens de recuperación; los contadores no dependen de usuarios.
      await prisma.$executeRawUnsafe('TRUNCATE TABLE users, groups, auth_throttles CASCADE');
      app.get(WorldsRepository).clearCache();
      seeds = new SequentialSeedSource(1);
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

  /** Inicia sesión con una cuenta que ya existe (p. ej. las cuentas de demostración). */
  static async login(ctx: TestContext, email: string, password: string): Promise<Player> {
    const login = await ctx.http().post('/api/auth/login').send({ email, password }).expect(200);
    const token: string = login.body.accessToken;
    const me = await ctx.http().get('/api/users/me').set('Authorization', `Bearer ${token}`).expect(200);
    return new Player(ctx, token, me.body.id);
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

  /** Solución de referencia (cumple las reglas activas) del intento: la lee de la BD, como haría un oráculo. */
  async solutionFor(attemptId: string): Promise<string> {
    const row = await this.ctx.prisma.challengeAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { sequenceChallenge: true },
    });
    if (!row.sequenceChallenge) throw new Error('El intento no pertenece a una secuencia.');
    return row.sequenceChallenge.referenceSolution;
  }

  /** Respuesta con un valor seguro distinto del esperado (WRONG_RESULT, sin tocar reglas). */
  async wrongAnswerFor(attemptId: string): Promise<string> {
    const row = await this.ctx.prisma.challengeAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { sequenceChallenge: true },
    });
    return `(${row.sequenceChallenge!.expectedResult}) + 1`;
  }

  /** Inicia el reto actual y lo resuelve con la solución de referencia. */
  async playCorrect(sessionId: string, secondsBeforeAnswering = 5) {
    const started = await this.startAttempt(sessionId);
    this.ctx.clock.advanceSeconds(secondsBeforeAnswering);
    const answered = await this.answer(
      started.body.attemptId,
      await this.solutionFor(started.body.attemptId),
    );
    return { started: started.body, answered: answered.body, status: answered.status };
  }

  /** Completa la secuencia en curso entera (reto a reto, con soluciones de referencia). */
  async completeWorld(world = 'arithmetic') {
    const session = await this.startSession(world);
    const sessionId: string = session.body.session.id;
    let last = await this.playCorrect(sessionId);
    while (last.answered.outcome === 'CORRECT' && !last.answered.worldCompleted) {
      last = await this.playCorrect(sessionId);
    }
    return { sessionId, last };
  }

  /** Abre sesión + reto actual y responde, devolviendo ambos cuerpos. */
  async play(sessionId: string, expression: string, secondsBeforeAnswering = 5) {
    const started = await this.startAttempt(sessionId);
    this.ctx.clock.advanceSeconds(secondsBeforeAnswering);
    const answered = await this.answer(started.body.attemptId, expression);
    return { started: started.body, answered: answered.body, status: answered.status };
  }
}
