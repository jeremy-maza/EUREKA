import { PrismaClient } from '../../src/generated/prisma/client';
import {
  DEFAULT_DEMO_PASSWORD,
  DEMO_ACCOUNTS,
  DEMO_EMAIL_DOMAIN,
  DEMO_GROUP_NAME,
  DemoScenarioId,
  resetDemoData,
  seedDemoData,
} from '../../prisma/demo/demo-fixtures';
import { createTestApp, Player, TestContext } from '../helpers/test-app';

const RULE_NO_2 = 'arithmetic.forbidden-digit-2';
const RULE_7X1 = 'arithmetic.required-7-times-1';
const RULE_NO_5 = 'arithmetic.forbidden-digit-5';

const keys = (rules: { key: string }[]) => rules.map((rule) => rule.key);

describe('Datos de demostración (fixtures reproducibles)', () => {
  let ctx: TestContext;
  const prisma = () => ctx.prisma as unknown as PrismaClient;
  const seed = () => seedDemoData(prisma(), { now: ctx.clock.now() });
  const emailOf = (scenario: DemoScenarioId | 'DOCENTE') =>
    DEMO_ACCOUNTS.find((account) => account.scenario === scenario)!.email;
  const loginAs = (scenario: DemoScenarioId | 'DOCENTE') =>
    Player.login(ctx, emailOf(scenario), DEFAULT_DEMO_PASSWORD);

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await ctx.reset();
    await seed();
  });

  describe('escenarios jugables a través de la API real', () => {
    it('A · jugador nuevo: sin progreso, puntos ni racha; el reto 1 sale sin reglas', async () => {
      const player = await loginAs('A');
      const progress = await player.get('/worlds/arithmetic/progress').expect(200);
      expect(progress.body).toMatchObject({
        status: 'IN_PROGRESS',
        currentPosition: 1,
        streak: 0,
        bestStreak: 0,
        totalPoints: 0,
        nextMultiplier: '1',
        unlockedRules: [],
        activeSessionId: null,
        statistics: { attemptsCount: 0 },
      });

      const session = await player.startSession().expect(201);
      const attempt = await player.startAttempt(session.body.session.id).expect(201);
      expect(attempt.body).toMatchObject({ position: 1, rules: [], newRule: null, expiredAttempt: null });
      expect(session.body.expiredAttempt).toBeNull();
    });

    it('B · progreso: 450 puntos, racha 3, 2 reglas; el reto 4 revela la tercera como nueva', async () => {
      const player = await loginAs('B');
      const progress = await player.get('/worlds/arithmetic/progress').expect(200);
      expect(progress.body).toMatchObject({
        status: 'IN_PROGRESS',
        currentPosition: 4,
        streak: 3,
        bestStreak: 3,
        totalPoints: 450,
        nextMultiplier: '2.5',
        statistics: { attemptsCount: 3, correctCount: 3, incorrectCount: 0, timeoutCount: 0 },
      });
      expect(keys(progress.body.unlockedRules)).toEqual([RULE_NO_2, RULE_7X1]);

      const session = await player.startSession().expect(200); // reanuda la sesión abierta del fixture
      const attempt = await player.startAttempt(session.body.session.id).expect(201);
      expect(attempt.body).toMatchObject({ position: 4, newRule: { key: RULE_NO_5 }, timeLimitSeconds: 90 });
      expect(keys(attempt.body.rules)).toEqual([RULE_NO_2, RULE_7X1, RULE_NO_5]);

      const ledger = await ctx.prisma.scoreTransaction.findMany({
        where: { userId: player.userId },
        orderBy: { id: 'asc' },
      });
      expect(ledger.map((row) => row.points)).toEqual([100, 150, 200]); // multiplicador creciente
    });

    it('C · secuencia fallida: racha 0, puntos históricos y reglas conservados, reinicio con reglas activas', async () => {
      const player = await loginAs('C');
      const progress = await player.get('/worlds/arithmetic/progress').expect(200);
      expect(progress.body).toMatchObject({
        currentPosition: 1,
        streak: 0,
        bestStreak: 3,
        totalPoints: 450,
        nextMultiplier: '1',
        statistics: { attemptsCount: 4, correctCount: 3, incorrectCount: 1, timeoutCount: 0 },
      });
      expect(keys(progress.body.unlockedRules)).toEqual([RULE_NO_2, RULE_7X1]); // la del reto fallido NO se acumuló
      // `5 * 8` vale 40 (correcto) pero usa el 5 prohibido y no contiene `7 * 1`: se informan las dos reglas rotas.
      expect(progress.body.statistics.ruleViolationCounts).toEqual({ [RULE_NO_5]: 1, [RULE_7X1]: 1 });

      const history = await player.get('/worlds/arithmetic/attempts').expect(200);
      expect(history.body.items[0]).toMatchObject({ outcome: 'INCORRECT', failureReason: 'RULE_VIOLATION' });

      // Reiniciar la secuencia: reto 1 pero con las reglas ya desbloqueadas activas desde el principio.
      const session = await player.startSession().expect(200);
      const attempt = await player.startAttempt(session.body.session.id).expect(201);
      expect(attempt.body).toMatchObject({ position: 1, newRule: null, timeLimitSeconds: 75 });
      expect(keys(attempt.body.rules)).toEqual([RULE_NO_2, RULE_7X1]);
    });

    it('D · avanzado: mundo completado dos veces, racha 8, ×5 en el próximo acierto y puntos 2 200', async () => {
      const player = await loginAs('D');
      const progress = await player.get('/worlds/arithmetic/progress').expect(200);
      expect(progress.body).toMatchObject({
        status: 'COMPLETED',
        streak: 8,
        bestStreak: 8,
        totalPoints: 2200,
        nextMultiplier: '5', // tope
        activeSessionId: null,
        statistics: { attemptsCount: 8, correctCount: 8, incorrectCount: 0 },
      });
      expect(keys(progress.body.unlockedRules)).toEqual([RULE_NO_2, RULE_7X1, RULE_NO_5]);

      // «Jugar de nuevo»: nueva sesión con las 3 reglas activas desde el reto 1 y racha conservada.
      const session = await player.startSession().expect(201);
      const attempt = await player.startAttempt(session.body.session.id).expect(201);
      expect(attempt.body).toMatchObject({ position: 1, newRule: null, timeLimitSeconds: 90 });
      expect(keys(attempt.body.rules)).toEqual([RULE_NO_2, RULE_7X1, RULE_NO_5]);

      const answered = await player.answer(attempt.body.attemptId, '7 * 1 * 3').expect(200);
      expect(answered.body.score).toMatchObject({ multiplier: '5', points: 500 });
      expect(answered.body.progress).toMatchObject({ streak: 9, totalPoints: 2700, nextMultiplier: '5' });
    });

    it('E · reto expirado: al entrar el servidor lo cierra por TIMEOUT y se puede reiniciar la secuencia', async () => {
      const player = await loginAs('E');
      const session = await player.startSession().expect(200); // sesión abierta del fixture
      expect(session.body.expiredAttempt).toEqual({
        attemptId: expect.any(String),
        outcome: 'TIMEOUT',
      });

      const progress = await player.get('/worlds/arithmetic/progress').expect(200);
      expect(progress.body).toMatchObject({
        currentPosition: 1,
        streak: 0,
        bestStreak: 2,
        totalPoints: 250,
        pendingAttemptId: null,
        statistics: { attemptsCount: 3, correctCount: 2, incorrectCount: 0, timeoutCount: 1 },
      });
      expect(keys(progress.body.unlockedRules)).toEqual([RULE_NO_2]);

      const history = await player.get('/worlds/arithmetic/attempts').expect(200);
      expect(history.body.items[0]).toMatchObject({ outcome: 'TIMEOUT', pointsAwarded: 0 });

      const attempt = await player.startAttempt(session.body.session.id).expect(201);
      expect(attempt.body).toMatchObject({ position: 1, newRule: null, expiredAttempt: null });
      expect(keys(attempt.body.rules)).toEqual([RULE_NO_2]);
    });

    it('el reto expirado también se detecta si se consulta "current" antes de iniciar la sesión', async () => {
      const player = await loginAs('E');
      const open = await ctx.prisma.gameSession.findFirstOrThrow({ where: { userId: player.userId } });
      await player.get(`/sessions/${open.id}/attempts/current`).expect(404); // cerrado por el servidor
      const progress = await player.get('/worlds/arithmetic/progress').expect(200);
      expect(progress.body.statistics.timeoutCount).toBe(1);
    });

    it('el docente demo ve el grupo y la clasificación incluye a los 5 estudiantes demo', async () => {
      const teacher = await loginAs('DOCENTE');
      const dashboard = await teacher.get('/teacher/dashboard').expect(200);
      expect(dashboard.body.groups).toHaveLength(1);
      expect(dashboard.body.groups[0].group.name).toBe(DEMO_GROUP_NAME);

      const board = await (await loginAs('D')).get('/worlds/arithmetic/leaderboard').expect(200);
      expect(board.body).toMatchObject({ scope: 'GROUPS', participants: 5 });
      expect(board.body.entries[0]).toMatchObject({ rank: 1, points: 2200, isCurrentUser: true });
    });
  });

  describe('reproducibilidad', () => {
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const account of DEMO_ACCOUNTS.filter((item) => item.role === 'STUDENT')) {
        const player = await Player.login(ctx, account.email, DEFAULT_DEMO_PASSWORD);
        const { body } = await player.get('/worlds/arithmetic/progress').expect(200);
        result[account.scenario] = {
          status: body.status,
          position: body.currentPosition,
          streak: body.streak,
          best: body.bestStreak,
          points: body.totalPoints,
          rules: keys(body.unlockedRules),
          stats: body.statistics,
        };
      }
      return result;
    };

    it('volver a ejecutar el seed da exactamente el mismo estado y no duplica cuentas', async () => {
      const first = await snapshot();
      await seed();
      expect(await snapshot()).toEqual(first);
      expect(await ctx.prisma.user.count({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } })).toBe(
        DEMO_ACCOUNTS.length,
      );
      expect(await ctx.prisma.group.count({ where: { name: DEMO_GROUP_NAME } })).toBe(1);
    });
  });

  describe('aislamiento de los datos reales', () => {
    it('reiniciar y regenerar el demo no toca usuarios reales (ni uno con un correo parecido) ni su historial', async () => {
      const real = await Player.register(ctx, 'maria@example.com', undefined, 'María');
      const lookalike = await Player.register(ctx, 'ana@mydemo.eureka.local', undefined, 'Ana');
      for (const player of [real, lookalike]) {
        const session = await player.startSession().expect(201);
        await player.play(session.body.session.id, '21');
      }
      const before = {
        users: await ctx.prisma.user.findMany({ where: { id: { in: [real.userId, lookalike.userId] } } }),
        ledger: await ctx.prisma.scoreTransaction.findMany({
          where: { userId: { in: [real.userId, lookalike.userId] } },
          orderBy: { id: 'asc' },
        }),
        attempts: await ctx.prisma.challengeAttempt.count({
          where: { userId: { in: [real.userId, lookalike.userId] } },
        }),
      };

      const summary = await resetDemoData(prisma());
      expect(summary).toEqual({ users: DEMO_ACCOUNTS.length, groups: 1, groupsKept: 0 });
      expect(await ctx.prisma.user.count({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } })).toBe(
        0,
      );
      await seed();

      expect({
        users: await ctx.prisma.user.findMany({ where: { id: { in: [real.userId, lookalike.userId] } } }),
        ledger: await ctx.prisma.scoreTransaction.findMany({
          where: { userId: { in: [real.userId, lookalike.userId] } },
          orderBy: { id: 'asc' },
        }),
        attempts: await ctx.prisma.challengeAttempt.count({
          where: { userId: { in: [real.userId, lookalike.userId] } },
        }),
      }).toEqual(before);
      const progress = await real.get('/worlds/arithmetic/progress').expect(200);
      expect(progress.body).toMatchObject({ totalPoints: 100, streak: 1 });
    });

    it('conserva el grupo demo si tiene miembros que no son cuentas demo', async () => {
      const real = await Player.register(ctx, 'luis@example.com');
      const group = await ctx.prisma.group.findFirstOrThrow({ where: { name: DEMO_GROUP_NAME } });
      await ctx.prisma.groupMembership.create({ data: { groupId: group.id, userId: real.userId } });

      const summary = await resetDemoData(prisma());
      expect(summary).toMatchObject({ groups: 0, groupsKept: 1 });
      expect(await ctx.prisma.groupMembership.count({ where: { userId: real.userId } })).toBe(1);
      expect(await ctx.prisma.user.count({ where: { id: real.userId } })).toBe(1);
    });

    it('el libro de puntos sigue siendo de solo inserción tras reiniciar el demo', async () => {
      const real = await Player.register(ctx, 'eva@example.com');
      const session = await real.startSession().expect(201);
      await real.play(session.body.session.id, '21');

      await resetDemoData(prisma());
      await expect(
        ctx.prisma.scoreTransaction.deleteMany({ where: { userId: real.userId } }),
      ).rejects.toThrow(/solo inserción/);
      expect(await ctx.prisma.scoreTransaction.count({ where: { userId: real.userId } })).toBe(1);
    });

    it('se niega a sembrar o reiniciar con NODE_ENV=production y no cambia nada', async () => {
      const env = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
      const usersBefore = await ctx.prisma.user.count();
      await expect(seedDemoData(prisma(), { env })).rejects.toThrow(/NODE_ENV=production/);
      await expect(resetDemoData(prisma(), env)).rejects.toThrow(/NODE_ENV=production/);
      expect(await ctx.prisma.user.count()).toBe(usersBefore);
    });

    it('falla con un mensaje claro si falta el catálogo del mundo', async () => {
      const empty = { world: { findUnique: async () => null } } as unknown as PrismaClient;
      await expect(seedDemoData(empty, { now: ctx.clock.now() })).rejects.toThrow(/npm run db:seed/);
    });
  });
});
