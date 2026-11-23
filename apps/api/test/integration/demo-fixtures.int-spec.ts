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
import { ALL_WORLDS } from '../../src/modules/worlds';
import { createTestApp, Player, TestContext } from '../helpers/test-app';

const keys = (rules: { key: string }[]) => rules.map((rule) => rule.key);
const [W1, W2, W3, W4, W5] = ALL_WORLDS;
/** Tiempo límite de un reto del Mundo 1 con `rules` reglas activas. */
const limitW1 = (rules: number) => 60 + Math.max(0, rules - 1) * 15 + W1.sequence.extraTimeSeconds;

describe('Datos de demostración (fixtures reproducibles)', () => {
  let ctx: TestContext;
  const prisma = () => ctx.prisma as unknown as PrismaClient;
  const seed = () => seedDemoData(prisma(), { now: ctx.clock.now() });
  const emailOf = (scenario: DemoScenarioId | 'DOCENTE') =>
    DEMO_ACCOUNTS.find((account) => account.scenario === scenario)!.email;
  const loginAs = (scenario: DemoScenarioId | 'DOCENTE') =>
    Player.login(ctx, emailOf(scenario), DEFAULT_DEMO_PASSWORD);
  const progressOf = async (player: Player, world = W1.slug) =>
    (await player.get(`/worlds/${world}/progress`).expect(200)).body;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await ctx.reset();
    await seed();
  });

  describe('escenarios jugables a través de la API real', () => {
    it('A · jugador nuevo: sin progreso; solo el Mundo 1 desbloqueado; el reto 1 sale sin reglas', async () => {
      const player = await loginAs('A');
      expect(await progressOf(player)).toMatchObject({
        status: 'IN_PROGRESS',
        currentPosition: 1,
        streak: 0,
        bestStreak: 0,
        totalPoints: 0,
        nextMultiplier: '1',
        unlockedRules: [],
        activeSessionId: null,
        activeSequence: null,
        unlocked: true,
        statistics: { attemptsCount: 0 },
      });
      expect(await progressOf(player, W2.slug)).toMatchObject({
        unlocked: false,
        unlockRequirement: { worldSlug: W1.slug, position: 1 },
      });
      const locked = await player.startSession(W2.slug).expect(403);
      expect(locked.body.message).toMatch(/Completa el Mundo 1/);

      const session = await player.startSession().expect(201);
      const attempt = await player.startAttempt(session.body.session.id).expect(201);
      expect(attempt.body).toMatchObject({ position: 1, rules: [], newRule: null, expiredAttempt: null });
      expect(session.body.expiredAttempt).toBeNull();
    });

    it('B · progreso: 450 puntos, racha 3, 2 reglas dominadas; el reto 4 revela la tercera como nueva', async () => {
      const player = await loginAs('B');
      const progress = await progressOf(player);
      expect(progress).toMatchObject({
        status: 'IN_PROGRESS',
        currentPosition: 4,
        streak: 3,
        bestStreak: 3,
        totalPoints: 450,
        nextMultiplier: '2.5',
        challengeCount: 4,
        activeSequence: { difficulty: 'BASELINE', challengeCount: 4 },
        statistics: { attemptsCount: 3, correctCount: 3, incorrectCount: 0, timeoutCount: 0 },
      });
      expect(progress.unlockedRules).toHaveLength(2);
      expect(keys(progress.activeSequence.rules)).toEqual(keys(progress.unlockedRules));

      const session = await player.startSession().expect(200); // reanuda la sesión abierta del fixture
      const attempt = await player.startAttempt(session.body.session.id).expect(201);
      expect(attempt.body).toMatchObject({ position: 4, timeLimitSeconds: limitW1(3) });
      expect(attempt.body.rules).toHaveLength(3);
      expect(keys(attempt.body.rules).slice(0, 2)).toEqual(keys(progress.activeSequence.rules));
      expect(attempt.body.newRule.key).toBe(attempt.body.rules[2].key);

      const ledger = await ctx.prisma.scoreTransaction.findMany({
        where: { userId: player.userId },
        orderBy: { id: 'asc' },
      });
      expect(ledger.map((row) => row.points)).toEqual([100, 150, 200]); // multiplicador creciente
    });

    it('C · secuencia fallida: racha 0, puntos conservados, reglas descartadas; la siguiente secuencia es nueva', async () => {
      const player = await loginAs('C');
      const progress = await progressOf(player);
      expect(progress).toMatchObject({
        currentPosition: 1,
        streak: 0,
        bestStreak: 3,
        totalPoints: 450,
        nextMultiplier: '1',
        activeSequence: null,
        statistics: { attemptsCount: 4, correctCount: 3, incorrectCount: 1, timeoutCount: 0 },
      });
      expect(progress.unlockedRules).toHaveLength(2); // la del reto fallido NO se domina
      expect(Object.values(progress.statistics.ruleViolationCounts).length).toBeGreaterThan(0);

      const history = await player.get(`/worlds/${W1.slug}/attempts`).expect(200);
      expect(history.body.items[0]).toMatchObject({ outcome: 'INCORRECT', failureReason: 'RULE_VIOLATION' });
      const failedSequence = await ctx.prisma.gameSequence.findFirstOrThrow({
        where: { userId: player.userId },
      });
      expect(failedSequence.status).toBe('FAILED');

      // Nueva secuencia: reto 1 sin reglas activas y otro sorteo.
      const session = await player.startSession().expect(200);
      const attempt = await player.startAttempt(session.body.session.id).expect(201);
      expect(attempt.body).toMatchObject({
        position: 1,
        newRule: null,
        rules: [],
        timeLimitSeconds: limitW1(0),
      });
      expect(attempt.body.sequenceId).not.toBe(failedSequence.id);
    });

    it('D · avanzado: Mundo 1 dos veces (racha 9, 2 700 pts, ×5) y Mundo 2 completado → Mundo 3 desbloqueado', async () => {
      const player = await loginAs('D');
      expect(await progressOf(player)).toMatchObject({
        status: 'COMPLETED',
        streak: 9,
        bestStreak: 9,
        totalPoints: 2700,
        nextMultiplier: '5', // tope
        completionsCount: 2,
        activeSessionId: null,
        statistics: { attemptsCount: 9, correctCount: 9, incorrectCount: 0 },
      });
      // La política adaptativa subió la dificultad en la segunda secuencia (ya había completado el mundo con racha).
      const sequences = await ctx.prisma.gameSequence.findMany({
        where: { userId: player.userId, world: { slug: W1.slug } },
        orderBy: { startedAt: 'asc' },
      });
      expect(sequences.map((q) => [q.difficulty, q.ruleKeys.length, q.status])).toEqual([
        ['BASELINE', W1.sequence.ruleCount.BASELINE, 'COMPLETED'],
        ['HARDER', W1.sequence.ruleCount.HARDER, 'COMPLETED'],
      ]);
      expect(await progressOf(player, W2.slug)).toMatchObject({
        completionsCount: 1,
        totalPoints: 700,
        unlocked: true,
      });
      expect(await progressOf(player, W3.slug)).toMatchObject({ unlocked: true, completionsCount: 0 });
      expect(await progressOf(player, W4.slug)).toMatchObject({
        unlocked: false,
        unlockRequirement: { worldSlug: W3.slug },
      });

      // «Jugar de nuevo»: secuencia nueva desde el reto 1 sin reglas; racha conservada, el acierto vale ×5.
      const session = await player.startSession().expect(201);
      const attempt = await player.startAttempt(session.body.session.id).expect(201);
      expect(attempt.body).toMatchObject({ position: 1, newRule: null, rules: [] });
      const answered = await player
        .answer(attempt.body.attemptId, await player.solutionFor(attempt.body.attemptId))
        .expect(200);
      expect(answered.body.score).toMatchObject({ multiplier: '5', points: 500 });
      expect(answered.body.progress).toMatchObject({ streak: 10, totalPoints: 3200, nextMultiplier: '5' });
    });

    it('E · reto expirado: al entrar el servidor lo cierra por TIMEOUT y la próxima secuencia empieza de cero', async () => {
      const player = await loginAs('E');
      const session = await player.startSession().expect(200); // sesión abierta del fixture
      expect(session.body.expiredAttempt).toEqual({ attemptId: expect.any(String), outcome: 'TIMEOUT' });

      const progress = await progressOf(player);
      expect(progress).toMatchObject({
        currentPosition: 1,
        streak: 0,
        bestStreak: 2,
        totalPoints: 250,
        pendingAttemptId: null,
        activeSequence: null,
        statistics: { attemptsCount: 3, correctCount: 2, incorrectCount: 0, timeoutCount: 1 },
      });
      expect(progress.unlockedRules).toHaveLength(1);

      const history = await player.get(`/worlds/${W1.slug}/attempts`).expect(200);
      expect(history.body.items[0]).toMatchObject({ outcome: 'TIMEOUT', pointsAwarded: 0 });

      const attempt = await player.startAttempt(session.body.session.id).expect(201);
      expect(attempt.body).toMatchObject({ position: 1, newRule: null, expiredAttempt: null, rules: [] });
    });

    it('el reto expirado también se detecta si se consulta "current" antes de iniciar la sesión', async () => {
      const player = await loginAs('E');
      const open = await ctx.prisma.gameSession.findFirstOrThrow({ where: { userId: player.userId } });
      await player.get(`/sessions/${open.id}/attempts/current`).expect(404); // cerrado por el servidor
      expect((await progressOf(player)).statistics.timeoutCount).toBe(1);
    });

    it('F · explorador: Mundos 1–4 completados; el Mundo 5 está desbloqueado y se juega con su sintaxis', async () => {
      const player = await loginAs('F');
      for (const world of [W1, W2, W3, W4]) {
        expect(await progressOf(player, world.slug)).toMatchObject({
          status: 'COMPLETED',
          completionsCount: 1,
          totalPoints: 700,
        });
      }
      expect(await progressOf(player, W5.slug)).toMatchObject({ unlocked: true, unlockRequirement: null });

      const session = await player.startSession(W5.slug).expect(201);
      const attempt = await player.startAttempt(session.body.session.id).expect(201);
      expect(attempt.body).toMatchObject({
        worldSlug: W5.slug,
        position: 1,
        syntax: { decimals: W5.syntax.decimals, powers: W5.syntax.powers },
      });
    });

    it('el docente demo ve el grupo y la clasificación incluye a los 6 estudiantes demo', async () => {
      const teacher = await loginAs('DOCENTE');
      const dashboard = await teacher.get('/teacher/dashboard').expect(200);
      expect(dashboard.body.groups).toHaveLength(1);
      expect(dashboard.body.groups[0].group.name).toBe(DEMO_GROUP_NAME);

      const board = await (await loginAs('D')).get(`/worlds/${W1.slug}/leaderboard`).expect(200);
      expect(board.body).toMatchObject({ scope: 'GROUPS', participants: 6 });
      expect(board.body.entries[0]).toMatchObject({ rank: 1, points: 2700, isCurrentUser: true });
    });
  });

  describe('reproducibilidad', () => {
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const account of DEMO_ACCOUNTS.filter((item) => item.role === 'STUDENT')) {
        const player = await Player.login(ctx, account.email, DEFAULT_DEMO_PASSWORD);
        const all = (await player.get('/progress').expect(200)).body;
        const sequences = await ctx.prisma.gameSequence.findMany({
          where: { userId: player.userId },
          orderBy: { startedAt: 'asc' },
          include: { challenges: { orderBy: { position: 'asc' } } },
        });
        result[account.scenario] = {
          progress: all.map((body: Record<string, unknown>) => ({
            world: body.worldSlug,
            status: body.status,
            position: body.currentPosition,
            streak: body.streak,
            best: body.bestStreak,
            points: body.totalPoints,
            completions: body.completionsCount,
            unlocked: body.unlocked,
            rules: keys(body.unlockedRules as { key: string }[]),
            stats: body.statistics,
          })),
          // Mismas semillas ⇒ mismos sorteos y mismos retos.
          sequences: sequences.map((q) => ({
            seed: q.seed,
            difficulty: q.difficulty,
            rules: q.ruleKeys,
            status: q.status,
            challenges: q.challenges.map((c) => [c.expression, c.expectedResult, c.referenceSolution]),
          })),
        };
      }
      return result;
    };

    it('volver a ejecutar el seed da exactamente el mismo estado (y las mismas secuencias) sin duplicar cuentas', async () => {
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

    it('falla con un mensaje claro si falta el catálogo de los mundos', async () => {
      const empty = { world: { findMany: async () => [] } } as unknown as PrismaClient;
      await expect(seedDemoData(empty, { now: ctx.clock.now() })).rejects.toThrow(/npm run db:seed/);
    });
  });
});
