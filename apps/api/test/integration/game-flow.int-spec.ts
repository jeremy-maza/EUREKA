import { ALL_WORLDS, syncWorldCatalog, WorldsRepository } from '../../src/modules/worlds';
import { CLASSIC_SOLUTIONS, RULE_7X1, RULE_NO_2, RULE_NO_5 } from '../helpers/scripted-planner';
import { createTestApp, Player, TestContext } from '../helpers/test-app';

// El Mundo 1 juega aquí la secuencia clásica (planificador de pruebas): valores exactos conocidos.
const REF = CLASSIC_SOLUTIONS; // válidas con TODAS las reglas de la secuencia

describe('Flujo de juego (HTTP + PostgreSQL real)', () => {
  let ctx: TestContext;
  let ana: Player;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await ctx.reset();
    ana = await Player.register(ctx, 'ana@example.com');
  });

  async function openSession(player = ana, world = 'arithmetic'): Promise<string> {
    const res = await player.startSession(world);
    expect([200, 201]).toContain(res.status);
    return res.body.session.id;
  }

  const ledger = (userId = ana.userId) =>
    ctx.prisma.scoreTransaction.findMany({ where: { userId }, orderBy: { id: 'asc' } });
  const ruleKeys = (body: { unlockedRules: { key: string }[] }) => body.unlockedRules.map((r) => r.key);

  describe('mundos y sesiones', () => {
    it('lista los cinco mundos en orden y responde 404 ante uno inexistente', async () => {
      const res = await ana.get('/worlds').expect(200);
      expect(res.body.map((w: { slug: string }) => w.slug)).toEqual(ALL_WORLDS.map((w) => w.slug));
      expect(res.body.map((w: { position: number }) => w.position)).toEqual([1, 2, 3, 4, 5]);
      expect(res.body[0]).toMatchObject({
        slug: 'arithmetic',
        name: 'Aritmética',
        position: 1,
        challengeCount: 4,
        syntax: { decimals: false, powers: false },
      });
      for (const world of res.body) {
        expect(world.ruleCount).toBeGreaterThanOrEqual(world.challengeCount - 1);
        expect(world.concepts.length).toBeGreaterThan(0);
      }
      await ana.post('/worlds/no-existe/sessions').expect(404);
      await ana.get('/worlds/no-existe/progress').expect(404);
    });

    it('iniciar sesión crea (201) y volver a iniciarla reanuda la misma (200)', async () => {
      const first = await ana.startSession().expect(201);
      expect(first.body).toMatchObject({
        created: true,
        session: { worldSlug: 'arithmetic', endedAt: null },
      });
      const second = await ana.startSession().expect(200);
      expect(second.body.created).toBe(false);
      expect(second.body.session.id).toBe(first.body.session.id);
    });

    it('iniciar sesión concurrentemente (jugador nuevo) crea una única sesión', async () => {
      const results = await Promise.all(Array.from({ length: 4 }, () => ana.startSession()));
      expect(new Set(results.map((r) => r.body.session.id)).size).toBe(1);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await ctx.prisma.studentWorldProgress.count()).toBe(1);
    });

    it('nunca sirve un mundo cuyas reglas del catálogo no estén sembradas en la BD (500 sin detalles)', async () => {
      await ctx.prisma.rule.delete({
        where: {
          worldId_key: {
            worldId: (await ctx.prisma.world.findUniqueOrThrow({ where: { slug: 'arithmetic' } })).id,
            key: RULE_NO_5,
          },
        },
      });
      ctx.app.get(WorldsRepository).clearCache();
      try {
        const res = await ana.post('/worlds/arithmetic/sessions');
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('Error interno del servidor.'); // sin filtrar detalles internos
      } finally {
        await syncWorldCatalog(ctx.prisma, ALL_WORLDS);
        ctx.app.get(WorldsRepository).clearCache();
      }
      await ana.post('/worlds/arithmetic/sessions').expect(201);
    });

    it('un progreso nuevo parte de cero sin crear filas en lecturas', async () => {
      const res = await ana.get('/worlds/arithmetic/progress').expect(200);
      expect(res.body).toMatchObject({
        status: 'IN_PROGRESS',
        currentPosition: 1,
        streak: 0,
        totalPoints: 0,
        nextMultiplier: '1',
        unlockedRules: [],
        activeSessionId: null,
        pendingAttemptId: null,
        unlocked: true,
        unlockRequirement: null,
        completionsCount: 0,
        firstCompletedAt: null,
        activeSequence: null,
        challengeCount: 4,
      });
      expect(await ctx.prisma.studentWorldProgress.count()).toBe(0);
    });

    it('terminar sesión es idempotente y no se permite con un reto en curso', async () => {
      const sessionId = await openSession();
      await ana.startAttempt(sessionId).expect(201);
      await ana.post(`/sessions/${sessionId}/end`).expect(409);

      ctx.clock.advanceSeconds(61); // vence el reto → TIMEOUT perezoso
      const ended = await ana.post(`/sessions/${sessionId}/end`).expect(200);
      expect(ended.body.endedAt).not.toBeNull();
      await ana.post(`/sessions/${sessionId}/end`).expect(200);
      await ana.startAttempt(sessionId).expect(409);
    });
  });

  describe('reto y respuesta correcta', () => {
    it('el reto 1 sale sin reglas con 60 s, plazo fijado por el servidor y sin revelar solución', async () => {
      const sessionId = await openSession();
      const res = await ana.startAttempt(sessionId).expect(201);

      expect(res.body).toMatchObject({
        position: 1,
        challengeCount: 4,
        statementKind: 'EXPRESSION',
        expression: '3 * 7',
        instruction: 'Escribe una expresión que valga lo mismo que la operación.',
        syntax: { decimals: false, powers: false },
        difficulty: 'BASELINE',
        sequenceId: expect.any(String),
        rules: [],
        newRule: null,
        timeLimitSeconds: 60,
        resumed: false,
        expiredAttempt: null,
        remainingMs: 60_000,
      });
      expect(Date.parse(res.body.deadlineAt) - Date.parse(res.body.startedAt)).toBe(60_000);
      expect(res.body.serverTime).toBe(res.body.startedAt);
      expect(JSON.stringify(res.body)).not.toMatch(/referenceSolution|expectedResult|"21"/);
    });

    it('iniciar el reto dos veces devuelve el mismo intento (reanudación) con el tiempo restante real', async () => {
      const sessionId = await openSession();
      const first = await ana.startAttempt(sessionId).expect(201);
      ctx.clock.advanceSeconds(20);
      const again = await ana.startAttempt(sessionId).expect(200);
      expect(again.body).toMatchObject({
        attemptId: first.body.attemptId,
        resumed: true,
        remainingMs: 40_000,
      });

      const current = await ana.get(`/sessions/${sessionId}/attempts/current`).expect(200);
      expect(current.body.attemptId).toBe(first.body.attemptId);
    });

    it('sin reto abierto, "current" responde 404', async () => {
      const sessionId = await openSession();
      await ana.get(`/sessions/${sessionId}/attempts/current`).expect(404);
    });

    it('acepta expresiones equivalentes y con "= resultado"', async () => {
      const sessionId = await openSession();
      const { answered } = await ana.play(sessionId, '(1 + 2) * 7');
      expect(answered).toMatchObject({ outcome: 'CORRECT', evaluatedValue: '21' });

      const second = await ana.play(sessionId, '41 + 1 = 42');
      expect(second.answered.outcome).toBe('CORRECT');
    });

    it('secuencia del enunciado: puntos 100/150/200, reglas que se guardan al completar y tiempo creciente', async () => {
      const sessionId = await openSession();

      const c1 = await ana.play(sessionId, '21');
      expect(c1.started).toMatchObject({ position: 1, timeLimitSeconds: 60, rules: [] });
      expect(c1.answered).toMatchObject({ outcome: 'CORRECT', unlockedRule: null, worldCompleted: false });
      expect(c1.answered.score).toEqual({
        basePoints: 100,
        multiplierMilli: 1000,
        multiplier: '1',
        points: 100,
      });
      expect(c1.answered.progress).toMatchObject({
        currentPosition: 2,
        streak: 1,
        totalPoints: 100,
        nextMultiplier: '1.5',
      });

      const c2 = await ana.play(sessionId, '41 + 1');
      expect(c2.started).toMatchObject({
        position: 2,
        expression: '3 * 7 * 2',
        timeLimitSeconds: 60,
        sequenceId: c1.started.sequenceId, // la misma secuencia
        instruction:
          'Escribe una expresión que valga lo mismo que la operación y que cumpla todas las reglas activas.',
      });
      expect(c2.started.newRule).toMatchObject({ key: RULE_NO_2, type: 'FORBIDDEN_DIGIT' });
      expect(c2.answered.unlockedRule).toMatchObject({ key: RULE_NO_2 });
      expect(c2.answered.score).toMatchObject({ multiplier: '1.5', points: 150 });
      expect(ruleKeys(c2.answered.progress)).toEqual([RULE_NO_2]);

      const c3 = await ana.play(sessionId, '7 * 1');
      expect(c3.started).toMatchObject({ position: 3, timeLimitSeconds: 75 }); // 2 reglas activas
      expect(c3.started.rules.map((r: { key: string }) => r.key)).toEqual([RULE_NO_2, RULE_7X1]);
      expect(c3.answered.score).toMatchObject({ multiplier: '2', points: 200 });
      expect(ruleKeys(c3.answered.progress)).toEqual([RULE_NO_2, RULE_7X1]);
      expect(c3.answered.progress).toMatchObject({ streak: 3, totalPoints: 450 });
      expect(c3.answered.progress.activeSequence).toMatchObject({
        difficulty: 'BASELINE',
        challengeCount: 4,
        rules: [{ key: RULE_NO_2 }, { key: RULE_7X1 }],
      });

      const c4 = await ana.play(sessionId, REF[3]);
      expect(c4.started.timeLimitSeconds).toBe(90); // 3 reglas activas
    });
  });

  describe('respuesta incorrecta', () => {
    it('resultado correcto que viola una regla activa: termina el reto, 0 puntos, racha a 0, reinicia secuencia', async () => {
      const sessionId = await openSession();
      await ana.play(sessionId, '21');

      const { answered } = await ana.play(sessionId, '21 * 2'); // 42 correcto, pero usa el dígito 2
      expect(answered).toMatchObject({
        outcome: 'INCORRECT',
        failureReason: 'RULE_VIOLATION',
        evaluatedValue: '42',
        sequenceRestarted: true,
        unlockedRule: null,
        discardedRules: [{ key: RULE_NO_2 }],
        nextWorldUnlocked: null,
      });
      expect(answered.violations).toEqual([
        expect.objectContaining({ ruleKey: RULE_NO_2, ruleType: 'FORBIDDEN_DIGIT' }),
      ]);
      expect(answered.score).toMatchObject({ points: 0, multiplierMilli: 0 });
      expect(answered.progress).toMatchObject({
        currentPosition: 1,
        streak: 0,
        bestStreak: 1,
        totalPoints: 100,
      });
      expect(ruleKeys(answered.progress)).toEqual([]); // la regla del reto fallido NO se domina
      expect(answered.progress.activeSequence).toBeNull(); // la secuencia terminó
      expect(await ledger()).toHaveLength(1); // solo el acierto del reto 1
      const sequences = await ctx.prisma.gameSequence.findMany({ where: { userId: ana.userId } });
      expect(sequences).toEqual([expect.objectContaining({ status: 'FAILED', endedAt: expect.any(Date) })]);
    });

    it.each([
      ['sintaxis inválida', '3 *', 'SYNTAX_ERROR'],
      ['división entre cero', '21 / (3 - 3)', 'DIVISION_BY_ZERO'],
      ['resultado erróneo', '22', 'WRONG_RESULT'],
      ['resultado declarado erróneo', '3 * 7 = 22', 'CLAIMED_RESULT_MISMATCH'],
      ['código en lugar de expresión', 'process.exit(1)', 'SYNTAX_ERROR'],
    ])('%s → INCORRECT (%s) y reinicio', async (_name, expression, reason) => {
      const sessionId = await openSession();
      const { answered, status } = await ana.play(sessionId, expression);
      expect(status).toBe(200);
      expect(answered).toMatchObject({
        outcome: 'INCORRECT',
        failureReason: reason,
        sequenceRestarted: true,
      });
      expect(answered.progress).toMatchObject({ currentPosition: 1, streak: 0, totalPoints: 0 });
    });

    it('falla en el reto 3: descarta las reglas de la secuencia; la siguiente empieza sin reglas y conserva puntos', async () => {
      const sessionId = await openSession();
      const first = await ana.play(sessionId, '21');
      await ana.play(sessionId, '41 + 1');
      const failed = await ana.play(sessionId, '14 / 2'); // 7 correcto, pero sin 7 * 1
      expect(failed.answered).toMatchObject({ outcome: 'INCORRECT', failureReason: 'RULE_VIOLATION' });
      expect(failed.answered.progress).toMatchObject({ currentPosition: 1, streak: 0, totalPoints: 250 });
      // Las DOS reglas activas de la secuencia se descartan (la superada y la nueva)…
      expect(failed.answered.discardedRules.map((r: { key: string }) => r.key)).toEqual([
        RULE_NO_2,
        RULE_7X1,
      ]);
      // …pero la superada queda en la colección de reglas dominadas.
      expect(ruleKeys(failed.answered.progress)).toEqual([RULE_NO_2]);

      // La nueva sesión no recupera reglas activas: empieza una secuencia nueva desde cero.
      await ana.post(`/sessions/${sessionId}/end`).expect(200);
      const next = await ana.startSession().expect(201);
      expect(next.body.session.id).not.toBe(sessionId);

      const replay = await ana.startAttempt(next.body.session.id).expect(201);
      expect(replay.body).toMatchObject({ position: 1, newRule: null, rules: [], timeLimitSeconds: 60 });
      expect(replay.body.sequenceId).not.toBe(first.started.sequenceId);

      // "21" vuelve a ser válido: las reglas de la secuencia fallida ya no existen.
      const retry = await ana.answer(replay.body.attemptId, '21').expect(200);
      expect(retry.body).toMatchObject({ outcome: 'CORRECT' });

      const sequences = await ctx.prisma.gameSequence.findMany({
        where: { userId: ana.userId },
        orderBy: { startedAt: 'asc' },
      });
      expect(sequences.map((q) => q.status)).toEqual(['FAILED', 'ACTIVE']);
      expect(new Set(sequences.map((q) => q.seed)).size).toBe(2); // cada secuencia con su semilla
    });
  });

  describe('temporizador del servidor', () => {
    it('responder en el instante exacto del plazo es válido', async () => {
      const sessionId = await openSession();
      const { answered } = await ana.play(sessionId, '21', 60);
      expect(answered.outcome).toBe('CORRECT');
    });

    it('responder tarde (aunque sea correcto) es TIMEOUT: sin puntos, racha a 0, reglas de la secuencia descartadas', async () => {
      const sessionId = await openSession();
      await ana.play(sessionId, '21');
      await ana.play(sessionId, '41 + 1'); // reglas: [no-2], racha 2, 250 puntos

      const { answered } = await ana.play(sessionId, '7 * 1', 76); // plazo del reto 3: 75 s
      expect(answered).toMatchObject({
        outcome: 'TIMEOUT',
        failureReason: 'TIMEOUT',
        evaluatedValue: null,
        sequenceRestarted: true,
        score: { points: 0 },
        discardedRules: [{ key: RULE_NO_2 }, { key: RULE_7X1 }],
      });
      expect(answered.progress).toMatchObject({
        currentPosition: 1,
        streak: 0,
        totalPoints: 250,
        activeSequence: null,
      });
      expect(ruleKeys(answered.progress)).toEqual([RULE_NO_2]); // dominada; ya no activa

      const history = await ana.get('/worlds/arithmetic/attempts').expect(200);
      expect(history.body.items[0]).toMatchObject({
        outcome: 'TIMEOUT',
        elapsedMs: 75_000,
        pointsAwarded: 0,
      });
    });

    it('un reto abandonado se cierra solo al vencer el plazo (al consultar el estado)', async () => {
      const sessionId = await openSession();
      const started = await ana.startAttempt(sessionId).expect(201);
      ctx.clock.advanceSeconds(120);

      const progress = await ana.get('/worlds/arithmetic/progress').expect(200);
      expect(progress.body).toMatchObject({ pendingAttemptId: null, currentPosition: 1, streak: 0 });
      expect(progress.body.statistics).toMatchObject({ attemptsCount: 1, timeoutCount: 1 });

      // Responder después devuelve el TIMEOUT ya registrado, no una evaluación nueva.
      const late = await ana.answer(started.body.attemptId, '21').expect(200);
      expect(late.body).toMatchObject({ outcome: 'TIMEOUT', replayed: true });
      expect(await ledger()).toHaveLength(0);
    });

    it('iniciar un reto cuando el anterior venció lo cierra como TIMEOUT y abre uno nuevo', async () => {
      const sessionId = await openSession();
      await ana.play(sessionId, '21');
      const second = await ana.startAttempt(sessionId).expect(201);
      expect(second.body.position).toBe(2);
      ctx.clock.advanceSeconds(61);

      const next = await ana.startAttempt(sessionId).expect(201);
      expect(next.body).toMatchObject({
        position: 1, // secuencia reiniciada
        resumed: false,
        expiredAttempt: { attemptId: second.body.attemptId, outcome: 'TIMEOUT' },
      });
      expect(next.body.attemptId).not.toBe(second.body.attemptId);
    });

    it('el cliente no puede aportar tiempos, puntos, rachas, reglas ni resultados esperados', async () => {
      const sessionId = await openSession();
      const started = await ana.startAttempt(sessionId).expect(201);
      for (const forged of [
        { submittedAt: '2020-01-01T00:00:00Z' },
        { elapsedMs: 1 },
        { points: 9999 },
        { streak: 99 },
        { unlockedRules: [] },
        { expectedResult: '22' },
      ]) {
        const res = await ana.answer(started.body.attemptId, '22').send({ expression: '22', ...forged });
        expect(res.status).toBe(400);
      }
      // Ninguno de los intentos manipulados consumió el reto.
      await ana.answer(started.body.attemptId, '21').expect(200);
    });

    it('valida la expresión: vacía, no-string o demasiado larga → 400', async () => {
      const sessionId = await openSession();
      const started = await ana.startAttempt(sessionId).expect(201);
      for (const expression of ['', 42, null, '1+'.repeat(101)]) {
        await ana.post(`/attempts/${started.body.attemptId}/answer`).send({ expression }).expect(400);
      }
      await ana.post(`/attempts/${started.body.attemptId}/answer`).send({}).expect(400);
    });
  });

  describe('integridad: un intento, una puntuación', () => {
    it('reenviar la misma respuesta es idempotente: mismo resultado y una sola transacción de puntos', async () => {
      const sessionId = await openSession();
      const started = await ana.startAttempt(sessionId).expect(201);
      const first = await ana.answer(started.body.attemptId, '21').expect(200);
      const second = await ana.answer(started.body.attemptId, '21').expect(200);

      expect(first.body.replayed).toBe(false);
      expect(second.body).toEqual({ ...first.body, replayed: true });
      expect(await ledger()).toHaveLength(1);
      const progress = await ana.get('/worlds/arithmetic/progress').expect(200);
      expect(progress.body).toMatchObject({ totalPoints: 100, streak: 1 });
    });

    it('un reto ya resuelto no se puede rejugar con otra respuesta (un solo intento)', async () => {
      const sessionId = await openSession();
      const started = await ana.startAttempt(sessionId).expect(201);
      await ana.answer(started.body.attemptId, '22').expect(200); // falla
      await ana.answer(started.body.attemptId, '21').expect(409); // ya no puede corregirse
      const progress = await ana.get('/worlds/arithmetic/progress').expect(200);
      expect(progress.body).toMatchObject({ totalPoints: 0, streak: 0 });
    });

    it('envíos concurrentes de la misma respuesta otorgan los puntos una sola vez', async () => {
      const sessionId = await openSession();
      const started = await ana.startAttempt(sessionId).expect(201);
      const results = await Promise.all(
        Array.from({ length: 4 }, () => ana.answer(started.body.attemptId, '21')),
      );

      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);
      expect(await ledger()).toHaveLength(1);
      expect((await ana.get('/worlds/arithmetic/progress')).body.totalPoints).toBe(100);
    });

    it('envíos concurrentes con respuestas distintas: gana uno, los demás reciben 409', async () => {
      const sessionId = await openSession();
      const started = await ana.startAttempt(sessionId).expect(201);
      const results = await Promise.all(
        ['21', '(1 + 2) * 7', '3 * 7'].map((e) => ana.answer(started.body.attemptId, e)),
      );

      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      expect(await ledger()).toHaveLength(1);
    });

    it('iniciar el reto concurrentemente crea un único intento abierto', async () => {
      const sessionId = await openSession();
      const results = await Promise.all(Array.from({ length: 4 }, () => ana.startAttempt(sessionId)));
      expect(new Set(results.map((r) => r.body.attemptId)).size).toBe(1);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await ctx.prisma.challengeAttempt.count({ where: { outcome: 'PENDING' } })).toBe(1);
    });

    it('la base de datos impide un segundo intento abierto y una segunda sesión abierta', async () => {
      const sessionId = await openSession();
      const started = await ana.startAttempt(sessionId).expect(201);
      const row = await ctx.prisma.challengeAttempt.findUniqueOrThrow({
        where: { id: started.body.attemptId },
      });
      const duplicate = {
        sessionId: row.sessionId,
        userId: row.userId,
        worldId: row.worldId,
        sequenceChallengeId: row.sequenceChallengeId,
        position: row.position,
        expression: row.expression,
        activeRuleKeys: row.activeRuleKeys,
        activeRulesCount: row.activeRulesCount,
        timeLimitSeconds: row.timeLimitSeconds,
        deadlineAt: row.deadlineAt,
        streakBefore: row.streakBefore,
      };
      await expect(ctx.prisma.challengeAttempt.create({ data: duplicate })).rejects.toThrow();
      await expect(
        ctx.prisma.gameSession.create({ data: { userId: ana.userId, worldId: row.worldId } }),
      ).rejects.toThrow();
    });

    it('el libro de puntos es de solo inserción (la BD rechaza UPDATE y DELETE)', async () => {
      const sessionId = await openSession();
      await ana.play(sessionId, '21');
      await expect(
        ctx.prisma.$executeRawUnsafe('UPDATE score_transactions SET points = 9999'),
      ).rejects.toThrow(/solo inserción/);
      await expect(ctx.prisma.$executeRawUnsafe('DELETE FROM score_transactions')).rejects.toThrow(
        /solo inserción/,
      );
      expect(await ledger()).toHaveLength(1);
    });
  });

  describe('propiedad y aislamiento entre jugadores', () => {
    it('otro jugador no puede ver ni usar sesiones o intentos ajenos (404)', async () => {
      const luis = await Player.register(ctx, 'luis@example.com');
      const sessionId = await openSession();
      const started = await ana.startAttempt(sessionId).expect(201);

      await luis.startAttempt(sessionId).expect(404);
      await luis.get(`/sessions/${sessionId}/attempts/current`).expect(404);
      await luis.post(`/sessions/${sessionId}/end`).expect(404);
      await luis.answer(started.body.attemptId, '21').expect(404);

      // El intento de Ana sigue intacto.
      await ana.answer(started.body.attemptId, '21').expect(200);
      expect((await luis.get('/worlds/arithmetic/progress')).body).toMatchObject({
        totalPoints: 0,
        streak: 0,
      });
    });

    it('identificadores mal formados → 400', async () => {
      await ana.startAttempt('no-es-uuid').expect(400);
      await ana.answer('no-es-uuid', '1').expect(400);
    });

    it('las rachas, reglas y puntos son independientes por mundo', async () => {
      await ana.completeWorld('arithmetic'); // desbloquea el Mundo 2 — racha 4, 700 puntos en el Mundo 1
      const a = await openSession(ana, 'arithmetic');
      await ana.play(a, REF[0]);

      const b = await openSession(ana, 'signs');
      const progressB = (await ana.get('/worlds/signs/progress').expect(200)).body;
      expect(progressB).toMatchObject({ streak: 0, totalPoints: 0, currentPosition: 1, unlockedRules: [] });

      const startedB = await ana.startAttempt(b).expect(201);
      const failB = await ana.answer(
        startedB.body.attemptId,
        await ana.wrongAnswerFor(startedB.body.attemptId),
      );
      expect(failB.body.outcome).toBe('INCORRECT');

      const all = (await ana.get('/progress').expect(200)).body;
      const byWorld = Object.fromEntries(all.map((p: { worldSlug: string }) => [p.worldSlug, p]));
      expect(byWorld['arithmetic']).toMatchObject({ streak: 5, totalPoints: 1000, currentPosition: 2 });
      expect(ruleKeys(byWorld['arithmetic'])).toEqual([RULE_NO_2, RULE_7X1, RULE_NO_5]);
      expect(byWorld['signs']).toMatchObject({ streak: 0, totalPoints: 0, currentPosition: 1 });
    });
  });

  describe('puntuación, rachas y finalización del mundo', () => {
    it('multiplicador 1x→5x con tope; completar el mundo cierra la sesión y la siguiente conserva reglas, puntos y racha', async () => {
      const multipliers: string[] = [];
      const points: number[] = [];

      // Primera pasada con las respuestas "naturales" (las reglas se acumulan según se completan).
      let sessionId = await openSession();
      let last;
      for (const answer of ['21', '41 + 1', '7 * 1', REF[3]]) {
        last = await ana.play(sessionId, answer);
        expect(last.answered.outcome).toBe('CORRECT');
        multipliers.push(last.answered.score.multiplier);
        points.push(last.answered.score.points);
      }
      expect(points).toEqual([100, 150, 200, 250]);
      expect(last?.answered).toMatchObject({
        worldCompleted: true,
        // La primera compleción desbloquea el Mundo 2.
        nextWorldUnlocked: { slug: 'signs', position: 2 },
        progress: {
          status: 'COMPLETED',
          totalPoints: 700,
          completionsCount: 1,
          firstCompletedAt: expect.any(String),
        },
      });
      expect((await ana.get('/worlds/signs/progress').expect(200)).body).toMatchObject({
        unlocked: true,
        unlockRequirement: null,
      });

      // La sesión terminó al completar el mundo; no se pueden iniciar más retos en ella.
      await ana.startAttempt(sessionId).expect(409);
      await ana.get(`/sessions/${sessionId}/attempts/current`).expect(404);

      // Nueva sesión: reinicia la secuencia conservando reglas, puntos y racha (completar no es fallar).
      for (let run = 0; run < 2; run++) {
        const res = await ana.startSession().expect(201);
        sessionId = res.body.session.id;
        const progress = (await ana.get('/worlds/arithmetic/progress')).body;
        expect(progress).toMatchObject({ status: 'IN_PROGRESS', currentPosition: 1, streak: 4 + run * 4 });
        // Dominadas: las tres. Activas al empezar la nueva secuencia: ninguna.
        expect(ruleKeys(progress)).toEqual([RULE_NO_2, RULE_7X1, RULE_NO_5]);
        expect(progress.completionsCount).toBe(run + 1);

        for (const answer of REF) {
          last = await ana.play(sessionId, answer);
          expect(last.answered.outcome).toBe('CORRECT');
          multipliers.push(last.answered.score.multiplier);
          points.push(last.answered.score.points);
        }
        expect(last?.answered).toMatchObject({ worldCompleted: true, nextWorldUnlocked: null }); // ya estaba
      }

      expect(multipliers).toEqual(['1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5', '5', '5', '5']);
      expect(points).toEqual([100, 150, 200, 250, 300, 350, 400, 450, 500, 500, 500, 500]);

      // El libro de puntos cuadra exactamente con el total, y nunca supera 5x.
      const rows = await ledger();
      expect(rows).toHaveLength(12);
      expect(rows.reduce((sum, r) => sum + r.points, 0)).toBe(points.reduce((a, b) => a + b, 0));
      expect(Math.max(...rows.map((r) => r.multiplierMilli))).toBe(5000);
      expect(rows.map((r) => r.streakAfter)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect((await ana.get('/worlds/arithmetic/progress')).body).toMatchObject({
        totalPoints: 4200,
        streak: 12,
      });
    });

    it('un fallo conserva el historial de puntos aunque reinicie la racha', async () => {
      const sessionId = await openSession();
      await ana.play(sessionId, '21');
      await ana.play(sessionId, '41 + 1');
      await ana.play(sessionId, 'x');

      const score = await ana.get('/worlds/arithmetic/score').expect(200);
      expect(score.body).toMatchObject({ totalPoints: 250, streak: 0, bestStreak: 2, nextMultiplier: '1' });
      expect(score.body.recentTransactions.map((t: { points: number }) => t.points)).toEqual([150, 100]); // recientes primero
      expect(score.body.recentTransactions[0]).toMatchObject({
        reason: 'CORRECT_ANSWER',
        multiplier: '1.5',
        streakAfter: 2,
      });
    });
  });

  describe('historial y estadísticas', () => {
    it('lista los intentos (con fallos y timeouts) paginados por cursor, más recientes primero', async () => {
      const sessionId = await openSession();
      await ana.play(sessionId, '21'); // CORRECT
      await ana.play(sessionId, '22'); // INCORRECT (reto 2) → reinicia la secuencia
      await ana.play(sessionId, '21'); // CORRECT (reto 1)
      await ana.play(sessionId, '41 + 1', 61); // TIMEOUT

      const all = (await ana.get('/worlds/arithmetic/attempts').expect(200)).body;
      expect(all.items.map((i: { outcome: string }) => i.outcome)).toEqual([
        'TIMEOUT',
        'CORRECT',
        'INCORRECT',
        'CORRECT',
      ]);
      expect(all.nextCursor).toBeNull();
      expect(all.items[1]).toMatchObject({
        position: 1,
        expression: '3 * 7',
        submission: '21',
        evaluatedValue: '21',
        pointsAwarded: 100,
      });

      const page1 = (await ana.get('/worlds/arithmetic/attempts?limit=3').expect(200)).body;
      expect(page1.items).toHaveLength(3);
      expect(page1.nextCursor).toBe(page1.items[2].attemptId);
      const page2 = (
        await ana.get(`/worlds/arithmetic/attempts?limit=3&cursor=${page1.nextCursor}`).expect(200)
      ).body;
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
      expect([...page1.items, ...page2.items].map((i) => i.attemptId)).toEqual(
        all.items.map((i: { attemptId: string }) => i.attemptId),
      );

      await ana.get('/worlds/arithmetic/attempts?limit=0').expect(400);
      await ana.get('/worlds/arithmetic/attempts?limit=101').expect(400);
      await ana.get('/worlds/arithmetic/attempts?cursor=xyz').expect(400);
    });

    it('el historial es solo del propio jugador y no revela soluciones', async () => {
      const luis = await Player.register(ctx, 'luis@example.com');
      const sessionId = await openSession();
      await ana.play(sessionId, '22');
      expect((await luis.get('/worlds/arithmetic/attempts')).body.items).toEqual([]);

      const body =
        JSON.stringify((await ana.get('/worlds/arithmetic/attempts')).body) +
        JSON.stringify((await ana.get('/progress')).body);
      expect(body).not.toMatch(/referenceSolution|expectedResult|7 \* 1 \* 3/);
    });

    it('acumula estadísticas: intentos, aciertos, fallos, timeouts, reglas incumplidas y tiempo medio', async () => {
      const sessionId = await openSession();
      await ana.play(sessionId, '21', 10); // acierto en 10 s
      await ana.play(sessionId, '21 * 2', 4); // viola el dígito 2
      await ana.play(sessionId, '21', 20); // acierto en 20 s (reto 1 otra vez)
      await ana.play(sessionId, '41 + 1', 70); // timeout

      const { statistics } = (await ana.get('/worlds/arithmetic/progress')).body;
      expect(statistics).toEqual({
        attemptsCount: 4,
        correctCount: 2,
        incorrectCount: 1,
        timeoutCount: 1,
        averageCorrectElapsedMs: 15_000,
        ruleViolationCounts: { [RULE_NO_2]: 1 },
      });
    });
  });

  describe('robustez: estado que ya no se puede jugar y desbloqueo', () => {
    it('una secuencia con reglas que el catálogo ya no tiene se retira sin culpa del jugador (sin 500)', async () => {
      const sessionId = await openSession();
      await ana.play(sessionId, REF[0]);
      const open = await ana.startAttempt(sessionId).expect(201); // reto 2 abierto
      // Simula un despliegue que renombró la regla: la secuencia guardada referencia una clave inexistente.
      await ctx.prisma.gameSequence.updateMany({
        where: { userId: ana.userId },
        data: { ruleKeys: ['arithmetic.removed-rule', RULE_7X1, RULE_NO_5] },
      });
      await ctx.prisma.challengeAttempt.update({
        where: { id: open.body.attemptId },
        data: { activeRuleKeys: ['arithmetic.removed-rule'] },
      });

      const progress = await ana.get('/progress').expect(200); // antes: 500 en todos los mundos
      expect(progress.body[0]).toMatchObject({
        currentPosition: 1,
        streak: 1,
        totalPoints: 100,
        pendingAttemptId: null,
      });
      const next = await ana.startAttempt(sessionId).expect(201);
      expect(next.body).toMatchObject({ position: 1, rules: [] });
      const retired = await ana.answer(open.body.attemptId, '42').expect(200);
      expect(retired.body).toMatchObject({ outcome: 'TIMEOUT', replayed: true });
      expect(retired.body.message).toMatch(/actualización del juego/);
      const statuses = await ctx.prisma.gameSequence.findMany({
        where: { userId: ana.userId },
        orderBy: { startedAt: 'asc' },
      });
      expect(statuses.map((q) => q.status)).toEqual(['FAILED', 'ACTIVE']);
    });

    it('un intento abierto del catálogo fijo antiguo se retira y el jugador puede seguir', async () => {
      const sessionId = await openSession();
      const started = await ana.startAttempt(sessionId).expect(201);
      // Fila del catálogo fijo antiguo (las BD actualizadas la conservan; aquí se crea para la prueba).
      const world = await ctx.prisma.world.findUniqueOrThrow({ where: { slug: 'arithmetic' } });
      const legacy = await ctx.prisma.challenge.upsert({
        where: { worldId_key: { worldId: world.id, key: 'arithmetic-001' } },
        create: {
          worldId: world.id,
          key: 'arithmetic-001',
          position: 1,
          expression: '3 * 7',
          expectedResult: '21',
          referenceSolution: '7 * 1 * 3',
        },
        update: {},
      });
      await ctx.prisma.challengeAttempt.update({
        where: { id: started.body.attemptId },
        data: { sequenceChallengeId: null, challengeId: legacy.id },
      });
      await ana.get(`/sessions/${sessionId}/attempts/current`).expect(404); // retirado, sin 500
      expect((await ana.get('/progress').expect(200)).body[0]).toMatchObject({
        pendingAttemptId: null,
        streak: 0,
      });
      const closed = await ctx.prisma.challengeAttempt.findUniqueOrThrow({
        where: { id: started.body.attemptId },
      });
      expect(closed).toMatchObject({
        outcome: 'TIMEOUT',
        resultMessage: expect.stringMatching(/actualización/),
      });
      const next = await ana.startAttempt(sessionId).expect(201);
      expect(next.body).toMatchObject({ position: 1, rules: [] });
    });

    it('startAttempt vuelve a comprobar el desbloqueo aunque la sesión ya esté abierta', async () => {
      await ana.completeWorld('arithmetic');
      const signs = (await ana.startSession('signs').expect(201)).body.session.id;
      // Reparación de datos: el Mundo 1 deja de constar como completado.
      await ctx.prisma.studentWorldProgress.updateMany({
        where: { userId: ana.userId, world: { slug: 'arithmetic' } },
        data: { completionsCount: 0, firstCompletedAt: null },
      });
      const denied = await ana.startAttempt(signs).expect(403);
      expect(denied.body.message).toMatch(/Completa el Mundo 1/);
    });

    it('reenviar la respuesta que completó el mundo devuelve el mismo desbloqueo (idempotente)', async () => {
      const { last } = await ana.completeWorld('arithmetic');
      const attemptId = last.answered.attemptId;
      const replay = await ana.answer(attemptId, await ana.solutionFor(attemptId)).expect(200);
      expect(replay.body).toMatchObject({
        replayed: true,
        worldCompleted: true,
        nextWorldUnlocked: { slug: 'signs', position: 2 },
      });
    });

    it('un resultado erróneo no revela el valor esperado', async () => {
      const sessionId = await openSession();
      const { answered } = await ana.play(sessionId, '22');
      expect(answered).toMatchObject({ outcome: 'INCORRECT', failureReason: 'WRONG_RESULT' });
      expect(answered.message).toBe('Tu expresión vale 22, pero no es el resultado de la operación.');
      expect(answered.message).not.toContain('21');
    });
  });
});
