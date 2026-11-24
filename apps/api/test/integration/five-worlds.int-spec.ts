import { ALL_WORLDS } from '../../src/modules/worlds';
import { createTestApp, Player, TestContext } from '../helpers/test-app';

/**
 * Los cinco mundos con el planificador REAL (secuencias generadas a partir de semillas deterministas): progresión y
 * desbloqueo, sorteo de reglas, descarte tras un fallo, dificultad adaptativa, sintaxis por mundo y confidencialidad.
 */
describe('Cinco mundos con secuencias generadas (HTTP + PostgreSQL real)', () => {
  let ctx: TestContext;
  let ana: Player;

  beforeAll(async () => {
    ctx = await createTestApp({ planner: 'real' });
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await ctx.reset();
    ana = await Player.register(ctx, 'ana@example.com');
  });

  const keys = (rules: { key: string }[]) => rules.map((rule) => rule.key);
  const poolOf = (slug: string) => new Set(ALL_WORLDS.find((w) => w.slug === slug)!.rules.map((r) => r.id));
  const sessionIn = async (player: Player, slug: string) => {
    const res = await player.startSession(slug);
    expect([200, 201]).toContain(res.status);
    return res.body.session.id as string;
  };
  const fail = async (player: Player, sessionId: string) => {
    const started = await player.startAttempt(sessionId).expect(201);
    const res = await player.answer(
      started.body.attemptId,
      await player.wrongAnswerFor(started.body.attemptId),
    );
    expect(res.body).toMatchObject({ outcome: 'INCORRECT', failureReason: 'WRONG_RESULT' });
    return { started: started.body, answered: res.body };
  };

  it('progresión completa: cada mundo se desbloquea al completar el anterior, del 1 al 5', async () => {
    for (const [index, world] of ALL_WORLDS.entries()) {
      const progress = (await ana.get(`/worlds/${world.slug}/progress`).expect(200)).body;
      expect(progress.unlocked).toBe(true);
      const next = ALL_WORLDS[index + 1];
      if (next) {
        // Aún bloqueado: el servidor lo impone (403) y explica el requisito.
        const locked = (await ana.get(`/worlds/${next.slug}/progress`).expect(200)).body;
        expect(locked).toMatchObject({ unlocked: false, unlockRequirement: { worldSlug: world.slug } });
        const denied = await ana.startSession(next.slug).expect(403);
        expect(denied.body.message).toContain(`Completa el Mundo ${world.position}`);
      }

      const { last } = await ana.completeWorld(world.slug);
      expect(last.answered).toMatchObject({ outcome: 'CORRECT', worldCompleted: true });
      expect(last.answered.nextWorldUnlocked).toEqual(
        next ? { slug: next.slug, name: next.name, position: next.position } : null,
      );
      expect(last.answered.progress).toMatchObject({ status: 'COMPLETED', completionsCount: 1 });
    }

    const all = (await ana.get('/progress').expect(200)).body;
    expect(all.map((p: { unlocked: boolean }) => p.unlocked)).toEqual([true, true, true, true, true]);
    expect(all.every((p: { completionsCount: number }) => p.completionsCount === 1)).toBe(true);
  });

  it('cada secuencia sortea un subconjunto del repertorio en orden variable; las reglas se revelan en ese orden', async () => {
    const world = ALL_WORLDS[0];
    const draws: string[][] = [];
    for (let i = 0; i < 6; i++) {
      const player = i === 0 ? ana : await Player.register(ctx, `p${i}@example.com`);
      const sessionId = await sessionIn(player, world.slug);
      const first = await player.playCorrect(sessionId);
      const sequence = await ctx.prisma.gameSequence.findUniqueOrThrow({
        where: { id: first.started.sequenceId },
      });
      expect(sequence.ruleKeys).toHaveLength(world.sequence.ruleCount.BASELINE);
      expect(new Set(sequence.ruleKeys).size).toBe(sequence.ruleKeys.length);
      for (const key of sequence.ruleKeys) expect(poolOf(world.slug).has(key)).toBe(true);
      draws.push(sequence.ruleKeys);

      // Las reglas se revelan una a una en el orden sorteado.
      const second = await player.playCorrect(sessionId);
      expect(second.started).toMatchObject({ position: 2, newRule: { key: sequence.ruleKeys[0] } });
      expect(keys(second.started.rules)).toEqual([sequence.ruleKeys[0]]);
      const third = await player.startAttempt(sessionId).expect(201);
      expect(keys(third.body.rules)).toEqual(sequence.ruleKeys.slice(0, 2));
    }
    // Semillas distintas ⇒ sorteos distintos (subconjunto u orden).
    expect(new Set(draws.map((d) => d.join('|'))).size).toBeGreaterThan(1);
  });

  it('un fallo descarta las reglas de la secuencia y la siguiente vuelve a sortear subconjunto y orden', async () => {
    const sessionId = await sessionIn(ana, 'arithmetic');
    const first = await ana.playCorrect(sessionId);
    await ana.playCorrect(sessionId);
    const failed = await fail(ana, sessionId); // reto 3
    expect(failed.answered.discardedRules).toHaveLength(2);
    expect(failed.answered.progress).toMatchObject({
      currentPosition: 1,
      streak: 0,
      totalPoints: 250,
      activeSequence: null,
    });

    const retry = await ana.playCorrect(sessionId);
    expect(retry.started).toMatchObject({ position: 1, rules: [] });
    expect(retry.started.sequenceId).not.toBe(first.started.sequenceId);
    const [old, current] = await Promise.all([
      ctx.prisma.gameSequence.findUniqueOrThrow({ where: { id: first.started.sequenceId } }),
      ctx.prisma.gameSequence.findUniqueOrThrow({ where: { id: retry.started.sequenceId } }),
    ]);
    expect(old.status).toBe('FAILED');
    expect(current.status).toBe('ACTIVE');
    expect(current.seed).not.toBe(old.seed);

    // El reto 2 introduce la PRIMERA regla del nuevo sorteo, no la de la secuencia fallida.
    const next = await ana.startAttempt(sessionId).expect(201);
    expect(keys(next.body.rules)).toEqual([current.ruleKeys[0]]);
  });

  it('dificultad adaptativa: tras 3 fallos seguidos la siguiente secuencia sortea menos reglas', async () => {
    const world = ALL_WORLDS[0];
    const sessionId = await sessionIn(ana, world.slug);
    for (let i = 0; i < 3; i++) await fail(ana, sessionId);
    const started = await ana.startAttempt(sessionId).expect(201);
    expect(started.body).toMatchObject({
      difficulty: 'EASIER',
      challengeCount: world.sequence.ruleCount.EASIER + 1,
    });
    const progress = (await ana.get(`/worlds/${world.slug}/progress`).expect(200)).body;
    expect(progress.activeSequence).toMatchObject({ difficulty: 'EASIER' });
  });

  it('cada mundo aplica su sintaxis: decimales en el 3, potencias en el 4; el Mundo 1 los rechaza', async () => {
    const [w1, , w3, w4] = ALL_WORLDS;
    expect(w3.syntax.decimals).toBe(true);
    expect(w4.syntax.powers).toBe(true);

    // Mundo 1: decimales y potencias son errores de sintaxis (fallo directo).
    let sessionId = await sessionIn(ana, w1.slug);
    let started = await ana.startAttempt(sessionId).expect(201);
    let expected = (
      await ctx.prisma.sequenceChallenge.findFirstOrThrow({
        where: { attempts: { some: { id: started.body.attemptId } } },
      })
    ).expectedResult;
    const decimalInW1 = await ana.answer(started.body.attemptId, `(${expected}) * 1.0`).expect(200);
    expect(decimalInW1.body).toMatchObject({ outcome: 'INCORRECT', failureReason: 'SYNTAX_ERROR' });

    // Desbloquea hasta el Mundo 4 para probar su sintaxis.
    for (const world of ALL_WORLDS.slice(0, 3)) await ana.completeWorld(world.slug);

    sessionId = await sessionIn(ana, w3.slug);
    started = await ana.startAttempt(sessionId).expect(201);
    expect(started.body.syntax).toEqual({ decimals: true, powers: w3.syntax.powers });
    expected = (
      await ctx.prisma.sequenceChallenge.findFirstOrThrow({
        where: { attempts: { some: { id: started.body.attemptId } } },
      })
    ).expectedResult;
    const decimal = await ana.answer(started.body.attemptId, `(${expected}) * 1.0`).expect(200);
    expect(decimal.body.outcome).toBe('CORRECT'); // reto 1: sin reglas; 1.0 es un decimal exacto

    sessionId = await sessionIn(ana, w4.slug);
    started = await ana.startAttempt(sessionId).expect(201);
    expect(started.body.syntax).toEqual({ decimals: w4.syntax.decimals, powers: true });
    expected = (
      await ctx.prisma.sequenceChallenge.findFirstOrThrow({
        where: { attempts: { some: { id: started.body.attemptId } } },
      })
    ).expectedResult;
    const power = await ana.answer(started.body.attemptId, `(${expected}) * 2 ^ 0`).expect(200);
    expect(power.body.outcome).toBe('CORRECT');
  });

  it('las ecuaciones del Mundo de Álgebra piden una expresión que valga x', async () => {
    for (const world of ALL_WORLDS.slice(0, 3)) await ana.completeWorld(world.slug);
    const algebra = ALL_WORLDS[3];
    const sessionId = await sessionIn(ana, algebra.slug);
    const kinds = new Set<string>();
    // Recorre varias secuencias completas buscando enunciados de ecuación.
    for (let run = 0; run < 3 && !kinds.has('EQUATION'); run++) {
      for (;;) {
        const { started, answered } = await ana.playCorrect(
          run === 0 ? sessionId : await sessionIn(ana, algebra.slug),
        );
        kinds.add(started.statementKind);
        if (started.statementKind === 'EQUATION') {
          expect(started.expression).toMatch(/x/);
          expect(started.instruction).toMatch(/valor sea x/);
          expect(answered.outcome).toBe('CORRECT');
        }
        if (answered.worldCompleted) break;
      }
    }
    expect(kinds.has('EQUATION')).toBe(true);
  });

  it('ninguna respuesta del juego revela soluciones ni resultados esperados', async () => {
    const sessionId = await sessionIn(ana, 'arithmetic');
    const bodies: unknown[] = [];
    const first = await ana.playCorrect(sessionId);
    bodies.push(first.started, first.answered);
    const failedRound = await fail(ana, sessionId);
    bodies.push(failedRound.started, failedRound.answered);
    bodies.push((await ana.get('/progress').expect(200)).body);
    bodies.push((await ana.get('/worlds/arithmetic/attempts').expect(200)).body);

    const challenges = await ctx.prisma.sequenceChallenge.findMany({
      where: { sequence: { userId: ana.userId } },
    });
    const text = JSON.stringify(bodies);
    expect(text).not.toMatch(/referenceSolution|expectedResult|fingerprint/);
    // Las soluciones que el jugador no escribió nunca aparecen (la suya propia sí, como `submission`).
    const submitted = new Set(
      (await ctx.prisma.challengeAttempt.findMany({ where: { userId: ana.userId } })).map(
        (a) => a.submission,
      ),
    );
    const hidden = challenges.filter(
      (c) => !submitted.has(c.referenceSolution) && c.referenceSolution.length > 3,
    );
    expect(hidden.length).toBeGreaterThan(0);
    for (const challenge of hidden) expect(text).not.toContain(JSON.stringify(challenge.referenceSolution));
  });

  it('las secuencias son auditables y reproducibles: la BD guarda semilla, dificultad, reglas y retos', async () => {
    const sessionId = await sessionIn(ana, 'arithmetic');
    const { started } = await ana.playCorrect(sessionId);
    const sequence = await ctx.prisma.gameSequence.findUniqueOrThrow({
      where: { id: started.sequenceId },
      include: { challenges: { orderBy: { position: 'asc' } } },
    });
    expect(sequence).toMatchObject({ status: 'ACTIVE', difficulty: 'BASELINE', endedAt: null });
    expect(sequence.challenges).toHaveLength(sequence.ruleKeys.length + 1);
    expect(sequence.challenges[0].introducesRuleKey).toBeNull();
    expect(sequence.challenges.slice(1).map((c) => c.introducesRuleKey)).toEqual(sequence.ruleKeys);

    // La BD impide dos secuencias activas a la vez para el mismo jugador y mundo.
    await expect(
      ctx.prisma.gameSequence.create({
        data: {
          userId: ana.userId,
          worldId: sequence.worldId,
          seed: 1,
          difficulty: 'BASELINE',
          ruleKeys: [],
          generatorVersion: 'x',
        },
      }),
    ).rejects.toThrow();
  });
});
