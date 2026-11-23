import { ALL_WORLDS } from '../../src/modules/worlds';
import { CLASSIC_SOLUTIONS, RULE_7X1, RULE_NO_2, RULE_NO_5 } from '../helpers/scripted-planner';
import { createTestApp, Player, TestContext } from '../helpers/test-app';

const arithmeticWorld = ALL_WORLDS[0];
const keys = (rules: { key: string }[]) => rules.map((rule) => rule.key);
// El Mundo 1 juega aquí la secuencia clásica (planificador de pruebas).
const REF = CLASSIC_SOLUTIONS;

/**
 * Recorrido completo de un jugador por el Mundo 1 comprobando, en CADA respuesta de la API, que solo se
 * exponen las reglas ya activas (el frontend pinta lo que recibe: si la API no filtra, la UI mostraría reglas futuras).
 */
describe('Reglas progresivas: recorrido de principio a fin (HTTP + PostgreSQL real)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.reset());

  /** Ninguna respuesta debe mencionar reglas que el jugador todavía no tiene activas. */
  const expectNoFutureRules = (body: unknown, allowed: string[]) => {
    const text = JSON.stringify(body);
    for (const rule of arithmeticWorld.rules.filter((item) => !allowed.includes(item.id))) {
      expect(text).not.toContain(rule.id);
      expect(text).not.toContain(rule.description);
    }
    expect(text).not.toMatch(/referenceSolution|expectedResult/);
  };

  it('las reglas aparecen una a una y se acumulan; un fallo las descarta (quedan como dominadas) y los puntos no cambian', async () => {
    // 1-2. Registro y acceso.
    const ana = await Player.register(ctx, 'ana@example.com', undefined, 'Ana');
    const me = await ana.get('/users/me').expect(200);
    expect(me.body).toMatchObject({ email: 'ana@example.com', displayName: 'Ana', role: 'STUDENT' });

    // 3-4. Mundo 1 y sesión: aún no hay reglas, y la lista de reglas desbloqueadas está vacía.
    const worlds = await ana.get('/worlds').expect(200);
    expect(worlds.body.map((world: { slug: string }) => world.slug)).toEqual(ALL_WORLDS.map((w) => w.slug));
    const sessionId = (await ana.startSession().expect(201)).body.session.id;
    expect((await ana.get('/worlds/arithmetic/rules').expect(200)).body).toEqual([]);

    // Reto 1: sin reglas.
    const c1 = await ana.startAttempt(sessionId).expect(201);
    expect(c1.body).toMatchObject({ position: 1, rules: [], newRule: null });
    expectNoFutureRules(c1.body, []);
    const r1 = await ana.answer(c1.body.attemptId, REF[0]).expect(200);
    expect(r1.body).toMatchObject({ outcome: 'CORRECT', unlockedRule: null });
    expectNoFutureRules(r1.body, []);

    // 5-8. Reto 2: aparece la primera regla (como nueva). Al completarlo queda desbloqueada.
    const c2 = await ana.startAttempt(sessionId).expect(201);
    expect(keys(c2.body.rules)).toEqual([RULE_NO_2]);
    expect(c2.body.newRule.key).toBe(RULE_NO_2);
    expectNoFutureRules(c2.body, [RULE_NO_2]);
    const r2 = await ana.answer(c2.body.attemptId, REF[1]).expect(200);
    expect(r2.body.unlockedRule.key).toBe(RULE_NO_2);
    expect(keys(r2.body.progress.unlockedRules)).toEqual([RULE_NO_2]);
    expectNoFutureRules(r2.body, [RULE_NO_2]);

    // Reto 3: la anterior sigue visible y activa; llega la segunda.
    const c3 = await ana.startAttempt(sessionId).expect(201);
    expect(keys(c3.body.rules)).toEqual([RULE_NO_2, RULE_7X1]);
    expect(c3.body.newRule.key).toBe(RULE_7X1);
    expectNoFutureRules(c3.body, [RULE_NO_2, RULE_7X1]);
    const r3 = await ana.answer(c3.body.attemptId, REF[2]).expect(200);
    expect(keys(r3.body.progress.unlockedRules)).toEqual([RULE_NO_2, RULE_7X1]);

    // Reto 4: tres reglas activas.
    const c4 = await ana.startAttempt(sessionId).expect(201);
    expect(keys(c4.body.rules)).toEqual([RULE_NO_2, RULE_7X1, RULE_NO_5]);
    expect(c4.body.newRule.key).toBe(RULE_NO_5);
    // Mientras el reto 4 está en curso, la regla nueva aún NO está desbloqueada (solo activa en este reto).
    expect(keys((await ana.get('/worlds/arithmetic/rules').expect(200)).body)).toEqual([RULE_NO_2, RULE_7X1]);
    expect((await ana.get('/worlds/arithmetic/progress').expect(200)).body).toMatchObject({
      totalPoints: 450,
      streak: 3,
    });

    // 9-10. Respuesta incorrecta (sintaxis): termina la secuencia y la racha vuelve a 0.
    const failed = await ana.answer(c4.body.attemptId, '5 *').expect(200);
    expect(failed.body).toMatchObject({
      outcome: 'INCORRECT',
      failureReason: 'SYNTAX_ERROR',
      sequenceRestarted: true,
      worldCompleted: false,
    });
    expect(failed.body.progress).toMatchObject({
      currentPosition: 1,
      streak: 0,
      bestStreak: 3,
      totalPoints: 450,
    });
    // Las tres reglas activas de la secuencia se descartan; las dos superadas quedan como dominadas.
    expect(keys(failed.body.discardedRules)).toEqual([RULE_NO_2, RULE_7X1, RULE_NO_5]);
    expect(keys(failed.body.progress.unlockedRules)).toEqual([RULE_NO_2, RULE_7X1]);
    expect(failed.body.progress.activeSequence).toBeNull();

    // 11-12. Nueva secuencia (misma sesión): reto 1 SIN reglas activas.
    const again = await ana.startAttempt(sessionId).expect(201);
    expect(again.body).toMatchObject({ position: 1, newRule: null, rules: [] });
    expect(again.body.sequenceId).not.toBe(c1.body.sequenceId);
    expectNoFutureRules(again.body, []);

    // 13-14. Los puntos históricos y las estadísticas reflejan los datos reales del servidor.
    const score = await ana.get('/worlds/arithmetic/score').expect(200);
    expect(score.body).toMatchObject({ totalPoints: 450, streak: 0 });
    const progress = await ana.get('/worlds/arithmetic/progress').expect(200);
    expect(progress.body).toMatchObject({
      currentPosition: 1,
      streak: 0,
      bestStreak: 3,
      totalPoints: 450,
      pendingAttemptId: again.body.attemptId,
      statistics: { attemptsCount: 4, correctCount: 3, incorrectCount: 1 },
    });
    const ledger = await ctx.prisma.scoreTransaction.findMany({
      where: { userId: ana.userId },
      orderBy: { id: 'asc' },
    });
    expect(ledger.reduce((sum, row) => sum + row.points, 0)).toBe(450);
  });

  it('un jugador nuevo no ve las reglas de otro jugador más avanzado', async () => {
    const ana = await Player.register(ctx, 'ana@example.com');
    const sessionId = (await ana.startSession().expect(201)).body.session.id;
    await ana.play(sessionId, REF[0]);
    await ana.play(sessionId, REF[1]);

    const luis = await Player.register(ctx, 'luis@example.com');
    expect((await luis.get('/worlds/arithmetic/rules').expect(200)).body).toEqual([]);
    const luisSession = (await luis.startSession().expect(201)).body.session.id;
    const attempt = await luis.startAttempt(luisSession).expect(201);
    expect(attempt.body.rules).toEqual([]);
  });
});
