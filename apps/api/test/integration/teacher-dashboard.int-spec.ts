import { ALL_WORLDS } from '../../src/modules/worlds';
import { UserRole } from '../../src/generated/prisma/client';
import { assignTeacher, enrollStudent, makeGroup } from '../helpers/factories';
import { createTestApp, Player, TestContext } from '../helpers/test-app';

// Soluciones que cumplen TODAS las reglas: reto 1 → "7 * 1 * 3", reto 2 → "7 * 1 * 6".
const C1 = '7 * 1 * 3';
const C2 = '7 * 1 * 6';
const WRONG = '22'; // incorrecta en cualquier reto

describe('API del panel docente (HTTP + PostgreSQL)', () => {
  let ctx: TestContext;
  let admin: Player;
  let teacherA: Player;
  let teacherB: Player;
  let ana: Player; // grupo 1: 2 aciertos y 1 fallo por regla
  let bea: Player; // grupo 1: 8 intentos, 1 acierto, 3 fallos finales
  let cy: Player; // grupo 1: nunca ha jugado
  let dan: Player; // grupo 2 (otro docente)
  let g1: string;
  let g2: string;
  let g3: string; // vacío, de teacherA

  async function play(player: Player, steps: [expression: string, seconds?: number][]) {
    const session = await player.startSession();
    const sessionId = session.body.session.id;
    for (const [expression, seconds] of steps) await player.play(sessionId, expression, seconds ?? 5);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.reset();
    admin = await Player.register(ctx, 'admin@example.com', UserRole.ADMIN);
    teacherA = await Player.register(ctx, 'profa@example.com', UserRole.TEACHER, 'Profa A');
    teacherB = await Player.register(ctx, 'profb@example.com', UserRole.TEACHER, 'Profe B');
    ana = await Player.register(ctx, 'ana@example.com', UserRole.STUDENT, 'Ana');
    bea = await Player.register(ctx, 'bea@example.com', UserRole.STUDENT, 'Bea');
    cy = await Player.register(ctx, 'cy@example.com', UserRole.STUDENT, 'Cy');
    dan = await Player.register(ctx, 'dan@example.com', UserRole.STUDENT, 'Dan');

    g1 = (await makeGroup(ctx.prisma, 'Grupo 1')).id;
    g2 = (await makeGroup(ctx.prisma, 'Grupo 2')).id;
    g3 = (await makeGroup(ctx.prisma, 'Grupo vacío')).id;
    await assignTeacher(ctx.prisma, g1, teacherA.userId);
    await assignTeacher(ctx.prisma, g3, teacherA.userId);
    await assignTeacher(ctx.prisma, g2, teacherB.userId);
    for (const s of [ana, bea, cy]) await enrollStudent(ctx.prisma, g1, s.userId);
    await enrollStudent(ctx.prisma, g2, dan.userId);

    // Ana: acierta 1 (5 s) y 2 (10 s) y viola la regla del 2 en el reto 3.
    await play(ana, [
      [C1, 5],
      [C2, 10],
      ['3 * 7 * 2 / 6', 5],
    ]);
    // Bea: 4 fallos, 1 acierto y 3 fallos más (los 3 últimos consecutivos).
    await play(bea, [[WRONG], [WRONG], [WRONG], [WRONG], [C1, 8], [WRONG], [WRONG], [WRONG]]);
    // Dan: un acierto y un fallo.
    await play(dan, [[C1, 6], [WRONG]]);
  });
  afterAll(() => ctx.close());

  const get = (player: Player, path: string) => player.get(path);

  describe('coherencia con los registros del juego', () => {
    it('puntos, rachas, aciertos y tiempos coinciden con lo que ve el propio estudiante y con el libro de puntos', async () => {
      const overview = await get(teacherA, `/teacher/groups/${g1}/students/${ana.userId}`).expect(200);
      const own = (await ana.get('/progress').expect(200)).body[0];
      const score = (await ana.get('/worlds/arithmetic/score').expect(200)).body;
      const ledger = await ctx.prisma.scoreTransaction.aggregate({
        where: { userId: ana.userId },
        _sum: { points: true },
      });

      const world = overview.body.worlds[0];
      expect(world).toMatchObject({
        worldSlug: 'arithmetic',
        progressStatus: 'IN_PROGRESS',
        points: own.totalPoints,
        currentStreak: own.streak,
        maxStreak: own.bestStreak,
        attempts: own.statistics.attemptsCount,
        correct: own.statistics.correctCount,
        incorrect: own.statistics.incorrectCount,
        timeouts: own.statistics.timeoutCount,
        averageCorrectResponseTimeMs: own.statistics.averageCorrectElapsedMs,
        unlockedRulesCount: own.unlockedRules.length,
      });
      expect(world.points).toBe(score.totalPoints);
      expect(world.points).toBe(ledger._sum.points); // fuente auditable
      // Valores concretos del escenario: 100 + 150 puntos; racha máxima 2; (5 s + 10 s) / 2 aciertos.
      expect(world).toMatchObject({
        points: 250,
        currentStreak: 0,
        maxStreak: 2,
        attempts: 3,
        correct: 2,
        incorrect: 1,
        accuracyPercent: 66.7,
        averageCorrectResponseTimeMs: 7500,
        challengesCompleted: 2,
        challengeCount: 4,
      });
      expect(overview.body.totals).toMatchObject({ points: 250, attempts: 3, challengesCompleted: 2 });
      expect(overview.body.student).toEqual({ id: ana.userId, displayName: 'Ana', email: 'ana@example.com' });
    });

    it('los totales del grupo suman exactamente los de sus estudiantes', async () => {
      const dash = await get(teacherA, `/teacher/groups/${g1}/dashboard`).expect(200);
      const page = await get(teacherA, `/teacher/groups/${g1}/dashboard/students`).expect(200);
      const students = page.body.items as { totals: Record<string, number> }[];
      for (const field of ['points', 'attempts', 'correct', 'incorrect', 'timeouts']) {
        expect(dash.body.activity.totals[field]).toBe(students.reduce((sum, s) => sum + s.totals[field], 0));
      }
      // Ana 250 pts / 3 intentos (5 s + 10 s); Bea 100 pts / 8 intentos (8 s); Cy nada.
      expect(dash.body.activity).toMatchObject({
        studentCount: 3,
        studentsWithActivity: 2,
        activeStudentsLast7Days: 2,
        totals: {
          points: 350,
          attempts: 11,
          correct: 3,
          incorrect: 8,
          timeouts: 0,
          accuracyPercent: 27.3,
          averageCorrectResponseTimeMs: 7667, // (5000 + 10000 + 8000) / 3 aciertos: promedio ponderado exacto
        },
      });
      expect(dash.body.group).toMatchObject({
        id: g1,
        name: 'Grupo 1',
        status: 'ACTIVE',
        activeStudentCount: 3,
      });
      // Una fila por mundo (los cinco), en orden; solo el Mundo 1 tiene actividad.
      expect(dash.body.worlds.map((w: { worldSlug: string }) => w.worldSlug)).toEqual(
        ALL_WORLDS.map((w) => w.slug),
      );
      expect(dash.body.worlds[0]).toEqual(
        expect.objectContaining({
          worldSlug: 'arithmetic',
          studentsStarted: 2,
          studentsCompleted: 0,
          points: 350,
        }),
      );
      for (const world of dash.body.worlds.slice(1)) {
        expect(world).toMatchObject({ studentsStarted: 0, points: 0, attempts: 0, accuracyPercent: null });
      }
      expect(page.body.items.map((i: { student: { displayName: string } }) => i.student.displayName)).toEqual(
        ['Ana', 'Bea', 'Cy'],
      );
    });

    it('las estadísticas por estudiante salen de los intentos reales (conteo por motivo de fallo)', async () => {
      const stats = await get(teacherA, `/teacher/groups/${g1}/statistics`).expect(200);
      const grouped = await ctx.prisma.challengeAttempt.groupBy({
        by: ['failureReason'],
        where: { userId: { in: [ana.userId, bea.userId] }, failureReason: { not: null } },
        _count: { _all: true },
      });
      const expected = Object.fromEntries(grouped.map((g) => [g.failureReason, g._count._all]));
      const actual = Object.fromEntries(
        stats.body.commonErrors.map((e: { reason: string; count: number }) => [e.reason, e.count]),
      );
      expect(actual).toEqual(expected);
      expect(Object.values(actual).reduce((a, b) => a + b, 0)).toBe(8);
      expect(actual).toHaveProperty('RULE_VIOLATION');
      expect(actual).toHaveProperty('WRONG_RESULT');
      const shares = stats.body.commonErrors.reduce(
        (sum: number, e: { sharePercent: number }) => sum + e.sharePercent,
        0,
      );
      expect(shares).toBeGreaterThan(99.5);
      expect(shares).toBeLessThan(100.5);
    });
  });

  describe('rendimiento de aprendizaje', () => {
    it('reglas incumplidas: suma de WorldStatistics.ruleViolationCounts con descripción del catálogo', async () => {
      const stats = await get(teacherA, `/teacher/groups/${g1}/statistics`).expect(200);
      const rows = await ctx.prisma.worldStatistics.findMany({
        where: { userId: { in: [ana.userId, bea.userId] } },
      });
      const expected: Record<string, number> = {};
      for (const row of rows) {
        for (const [rule, n] of Object.entries(row.ruleViolationCounts as Record<string, number>)) {
          expected[rule] = (expected[rule] ?? 0) + n;
        }
      }
      expect(Object.keys(expected).length).toBeGreaterThan(0);
      for (const [ruleKey, violations] of Object.entries(expected)) {
        expect(stats.body.frequentlyViolatedRules).toContainEqual(
          expect.objectContaining({ ruleKey, violations }),
        );
      }
      const digit2 = stats.body.frequentlyViolatedRules.find(
        (r: { ruleKey: string }) => r.ruleKey === 'arithmetic.forbidden-digit-2',
      );
      expect(digit2).toMatchObject({
        worldSlug: 'arithmetic',
        ruleType: 'FORBIDDEN_DIGIT',
        description: 'No puedes usar el dígito 2.',
        studentsAffected: 2,
      });
      const counts = stats.body.frequentlyViolatedRules.map((r: { violations: number }) => r.violations);
      expect(counts).toEqual([...counts].sort((a, b) => b - a)); // orden descendente
    });

    it('estudiantes con precisión baja o fallos repetidos (y solo ellos)', async () => {
      const stats = await get(teacherA, `/teacher/groups/${g1}/statistics`).expect(200);
      expect(stats.body.thresholds).toEqual({
        minAttempts: 5,
        lowAccuracyBelow: 50,
        repeatedFailures: 3,
        top: 10,
      });
      expect(stats.body.studentsNeedingAttention).toEqual([
        {
          student: { id: bea.userId, displayName: 'Bea' },
          reasons: ['LOW_ACCURACY', 'REPEATED_FAILURES'],
          attempts: 8,
          accuracyPercent: 12.5,
          consecutiveFailures: 3,
        },
      ]);
      // Con datos insuficientes (minAttempts alto) la precisión baja no se marca, pero los fallos repetidos sí.
      const strict = await get(teacherA, `/teacher/groups/${g1}/statistics?minAttempts=50`).expect(200);
      expect(strict.body.studentsNeedingAttention[0].reasons).toEqual(['REPEATED_FAILURES']);
      // Umbral más exigente: Ana (66,7 %) también aparece por precisión.
      const picky = await get(
        teacherA,
        `/teacher/groups/${g1}/statistics?minAttempts=3&lowAccuracyBelow=70`,
      ).expect(200);
      expect(
        picky.body.studentsNeedingAttention.map(
          (s: { student: { displayName: string } }) => s.student.displayName,
        ),
      ).toEqual(['Bea', 'Ana']);
      await get(teacherA, `/teacher/groups/${g1}/statistics?minAttempts=0`).expect(400);
      await get(teacherA, `/teacher/groups/${g1}/statistics?top=abc`).expect(400);
    });

    it('retos a reforzar: solo los de precisión baja con suficientes intentos', async () => {
      const stats = await get(teacherA, `/teacher/groups/${g1}/statistics?minAttempts=2`).expect(200);
      expect(stats.body.challengesNeedingReinforcement).toEqual([
        {
          worldSlug: 'arithmetic',
          position: 1,
          expression: '3 * 7',
          attempts: 8,
          correct: 2,
          failures: 6,
          failureRatePercent: 75,
        },
      ]);
      expect(JSON.stringify(stats.body)).not.toMatch(/referenceSolution|expectedResult/);
    });

    it('estadísticas de un estudiante: por mundo, con retos sin jugar como 0 intentos y tasa no disponible', async () => {
      const res = await get(teacherA, `/teacher/groups/${g1}/students/${bea.userId}/statistics`).expect(200);
      expect(res.body.student).toMatchObject({ id: bea.userId, email: 'bea@example.com' });
      const [world] = res.body.worlds;
      expect(world).toMatchObject({
        worldSlug: 'arithmetic',
        attempts: 8,
        correct: 1,
        incorrect: 7,
        accuracyPercent: 12.5,
        averageCorrectResponseTimeMs: 8000,
        consecutiveFailures: 3,
        points: 100,
      });
      // Una fila por posición posible (la secuencia más larga del mundo: dificultad intensa).
      expect(world.challenges).toHaveLength(ALL_WORLDS[0].sequence.ruleCount.HARDER + 1);
      expect(world.challenges[0]).toMatchObject({ position: 1, attempts: 7, correct: 1, failures: 6 });
      expect(world.challenges[2]).toEqual({
        worldSlug: 'arithmetic',
        position: 3,
        expression: '', // sin intentos en esa posición: no hay enunciado de ejemplo
        attempts: 0,
        correct: 0,
        failures: 0,
        failureRatePercent: null, // no disponible (sin intentos), no 0 %
      });
      expect(world.commonErrors.reduce((n: number, e: { count: number }) => n + e.count, 0)).toBe(7);
      expect(world.violatedRules).toContainEqual(
        expect.objectContaining({ ruleKey: 'arithmetic.forbidden-digit-2', violations: 1 }),
      );
    });
  });

  describe('grupos vacíos y estudiantes sin actividad: "no disponible" ≠ 0', () => {
    it('un grupo vacío devuelve ceros reales y métricas no disponibles (null)', async () => {
      const dash = await get(teacherA, `/teacher/groups/${g3}/dashboard`).expect(200);
      expect(dash.body.activity).toEqual({
        studentCount: 0,
        studentsWithActivity: 0,
        activeStudentsLast7Days: 0,
        lastActivityAt: null,
        totals: {
          points: 0,
          attempts: 0,
          correct: 0,
          incorrect: 0,
          timeouts: 0,
          accuracyPercent: null,
          averageCorrectResponseTimeMs: null,
        },
      });
      expect(dash.body.worlds[0]).toMatchObject({
        studentsStarted: 0,
        studentsCompleted: 0,
        accuracyPercent: null,
      });

      const stats = await get(teacherA, `/teacher/groups/${g3}/statistics`).expect(200);
      expect(stats.body).toMatchObject({
        studentCount: 0,
        commonErrors: [],
        frequentlyViolatedRules: [],
        challengesNeedingReinforcement: [],
        studentsNeedingAttention: [],
      });
      expect(stats.body.performanceByWorld[0]).toMatchObject({ attempts: 0, accuracyPercent: null });
      expect((await get(teacherA, `/teacher/groups/${g3}/dashboard/students`).expect(200)).body).toEqual({
        items: [],
        nextCursor: null,
      });
    });

    it('un estudiante que nunca ha jugado no tiene precisión ni tiempo medio, pero sí contadores en 0', async () => {
      const res = await get(teacherA, `/teacher/groups/${g1}/students/${cy.userId}`).expect(200);
      expect(res.body.totals).toEqual({
        points: 0,
        attempts: 0,
        correct: 0,
        incorrect: 0,
        timeouts: 0,
        accuracyPercent: null,
        averageCorrectResponseTimeMs: null,
        challengesCompleted: 0,
        lastActivityAt: null,
      });
      expect(res.body.worlds[0]).toMatchObject({
        progressStatus: 'NOT_STARTED',
        currentPosition: null,
        currentStreak: 0,
        maxStreak: 0,
        accuracyPercent: null,
        averageCorrectResponseTimeMs: null,
      });
      const stats = await get(teacherA, `/teacher/groups/${g1}/students/${cy.userId}/statistics`).expect(200);
      expect(stats.body.worlds[0].consecutiveFailures).toBe(0);
      const attempts = await get(teacherA, `/teacher/groups/${g1}/students/${cy.userId}/attempts`).expect(
        200,
      );
      expect(attempts.body).toEqual({ items: [], nextCursor: null });
    });
  });

  describe('historial de intentos', () => {
    it('pagina por cursor (más recientes primero) sin duplicados ni datos sensibles', async () => {
      const seen: { attemptId: string; outcome: string; worldSlug: string }[] = [];
      let cursor = '';
      for (let i = 0; i < 6; i++) {
        const page = await get(
          teacherA,
          `/teacher/groups/${g1}/students/${bea.userId}/attempts?limit=3${cursor}`,
        ).expect(200);
        seen.push(...page.body.items);
        if (!page.body.nextCursor) break;
        cursor = `&cursor=${page.body.nextCursor}`;
      }
      expect(seen).toHaveLength(8);
      expect(new Set(seen.map((a) => a.attemptId)).size).toBe(8);
      // Cronológico: 4 fallos, 1 acierto, 3 fallos → más recientes primero.
      expect(seen.map((a) => a.outcome)).toEqual([
        'INCORRECT',
        'INCORRECT',
        'INCORRECT',
        'CORRECT',
        'INCORRECT',
        'INCORRECT',
        'INCORRECT',
        'INCORRECT',
      ]);
      expect(seen.every((a) => a.worldSlug === 'arithmetic')).toBe(true);
      const ids = seen.map((a) => a.attemptId);
      expect(ids).toEqual([...ids].sort().reverse());

      const raw = JSON.stringify(seen);
      expect(raw).not.toMatch(/referenceSolution|expectedResult/);
      await get(teacherA, `/teacher/groups/${g1}/students/${bea.userId}/attempts?worldSlug=no-existe`).expect(
        404,
      );
      await get(teacherA, `/teacher/groups/${g1}/students/${bea.userId}/attempts?limit=101`).expect(400);
      const filtered = await get(
        teacherA,
        `/teacher/groups/${g1}/students/${bea.userId}/attempts?worldSlug=arithmetic&limit=1`,
      ).expect(200);
      expect(filtered.body.items).toHaveLength(1);
    });

    it('no muestra intentos en curso (PENDING)', async () => {
      const session = await cy.startSession();
      await cy.startAttempt(session.body.session.id).expect(201);
      const page = await get(teacherA, `/teacher/groups/${g1}/students/${cy.userId}/attempts`).expect(200);
      expect(page.body.items).toEqual([]);
      // Un intento pendiente tampoco cuenta como fallo ni acierto en las métricas.
      const overview = await get(teacherA, `/teacher/groups/${g1}/students/${cy.userId}`).expect(200);
      expect(overview.body.totals).toMatchObject({ attempts: 0, accuracyPercent: null });
      await ctx.prisma.challengeAttempt.deleteMany({ where: { userId: cy.userId } });
      await ctx.prisma.gameSession.deleteMany({ where: { userId: cy.userId } });
      await ctx.prisma.gameSequence.deleteMany({ where: { userId: cy.userId } });
      await ctx.prisma.studentWorldProgress.deleteMany({ where: { userId: cy.userId } });
    });
  });

  describe('panel general del docente', () => {
    it('lista solo los grupos activos asignados, con su actividad', async () => {
      const res = await get(teacherA, '/teacher/dashboard').expect(200);
      expect(res.body.groups.map((g: { group: { name: string } }) => g.group.name)).toEqual([
        'Grupo 1',
        'Grupo vacío',
      ]);
      const [first, empty] = res.body.groups;
      expect(first.group).toMatchObject({
        id: g1,
        status: 'ACTIVE',
        createdAt: expect.any(String),
        activeStudentCount: 3,
      });
      expect(first.activity).toMatchObject({
        studentCount: 3,
        studentsWithActivity: 2,
        totals: { points: 350, attempts: 11 },
      });
      expect(empty.activity).toMatchObject({
        studentCount: 0,
        lastActivityAt: null,
        totals: { accuracyPercent: null },
      });

      const b = await get(teacherB, '/teacher/dashboard').expect(200);
      expect(b.body.groups.map((g: { group: { id: string } }) => g.group.id)).toEqual([g2]);
      expect(b.body.groups[0].activity.totals).toMatchObject({
        points: 100,
        attempts: 2,
        correct: 1,
        incorrect: 1,
        accuracyPercent: 50,
      });
    });

    it('un grupo desactivado deja de listarse en el panel general pero su detalle sigue siendo legible', async () => {
      await admin.post(`/admin/groups/${g3}/deactivate`).expect(200);
      const res = await get(teacherA, '/teacher/dashboard').expect(200);
      expect(res.body.groups.map((g: { group: { id: string } }) => g.group.id)).toEqual([g1]);
      expect((await get(teacherA, `/teacher/groups/${g3}/dashboard`).expect(200)).body.group.status).toBe(
        'INACTIVE',
      );
      await admin.post(`/admin/groups/${g3}/reactivate`).expect(200);
    });
  });

  describe('aislamiento de datos entre docentes (IDs válidos de otros grupos)', () => {
    const groupRoutes = (g: string) => [
      `/teacher/groups/${g}`,
      `/teacher/groups/${g}/students`,
      `/teacher/groups/${g}/dashboard`,
      `/teacher/groups/${g}/dashboard/students`,
      `/teacher/groups/${g}/statistics`,
    ];
    const studentRoutes = (g: string, s: string) => [
      `/teacher/groups/${g}/students/${s}`,
      `/teacher/groups/${g}/students/${s}/statistics`,
      `/teacher/groups/${g}/students/${s}/attempts`,
    ];

    it('un docente no accede a grupos de otro docente, aunque conozca los ids', async () => {
      for (const path of [...groupRoutes(g2), ...studentRoutes(g2, dan.userId)]) {
        const res = await get(teacherA, path);
        expect([path, res.status]).toEqual([path, 404]);
      }
      for (const path of [...groupRoutes(g1), ...studentRoutes(g1, ana.userId)]) {
        const res = await get(teacherB, path);
        expect([path, res.status]).toEqual([path, 404]);
      }
    });

    it('un estudiante de otro grupo es inaccesible incluso desde un grupo propio', async () => {
      for (const path of studentRoutes(g1, dan.userId)) {
        const res = await get(teacherA, path);
        expect([path, res.status]).toEqual([path, 404]);
      }
      for (const path of studentRoutes(g2, ana.userId)) {
        const res = await get(teacherB, path);
        expect([path, res.status]).toEqual([path, 404]);
      }
      // Misma respuesta que para un estudiante inexistente: no revela si el usuario existe.
      const foreign = await get(teacherA, `/teacher/groups/${g1}/students/${dan.userId}`).expect(404);
      const unknown = await get(
        teacherA,
        `/teacher/groups/${g1}/students/0198a5c0-0000-7000-8000-000000000001`,
      ).expect(404);
      expect(foreign.body.message).toBe(unknown.body.message);
    });

    it('las respuestas propias nunca contienen datos de estudiantes o grupos ajenos', async () => {
      const bodies = await Promise.all(
        [
          '/teacher/dashboard',
          '/teacher/groups',
          `/teacher/groups/${g1}`,
          `/teacher/groups/${g1}/students`,
          `/teacher/groups/${g1}/dashboard`,
          `/teacher/groups/${g1}/dashboard/students`,
          `/teacher/groups/${g1}/statistics`,
        ].map((path) => get(teacherA, path).expect(200)),
      );
      const raw = JSON.stringify(bodies.map((r) => r.body));
      for (const secret of [dan.userId, 'dan@example.com', g2, 'Grupo 2', 'Profe B'])
        expect(raw).not.toContain(secret);
      expect(raw).not.toMatch(/passwordHash|scrypt/);
      // Y el docente B no ve nada de Ana ni de Bea.
      const b = JSON.stringify(
        (
          await Promise.all(
            [
              '/teacher/dashboard',
              `/teacher/groups/${g2}/dashboard/students`,
              `/teacher/groups/${g2}/statistics`,
            ].map((p) => get(teacherB, p).expect(200)),
          )
        ).map((r) => r.body),
      );
      for (const secret of [ana.userId, bea.userId, 'ana@example.com', g1]) expect(b).not.toContain(secret);
    });

    it('estudiantes y administradores no acceden a los endpoints del docente; sin token → 401', async () => {
      const paths = [
        '/teacher/dashboard',
        `/teacher/groups/${g1}/dashboard`,
        `/teacher/groups/${g1}/statistics`,
        `/teacher/groups/${g1}/students/${ana.userId}`,
        `/teacher/groups/${g1}/students/${ana.userId}/statistics`,
        `/teacher/groups/${g1}/students/${ana.userId}/attempts`,
      ];
      for (const path of paths) {
        expect([path, (await get(ana, path)).status]).toEqual([path, 403]);
        expect([path, (await get(admin, path)).status]).toEqual([path, 403]);
        expect([path, (await ctx.http().get(`/api${path}`)).status]).toEqual([path, 401]);
      }
    });

    it('un docente con la asignación revocada pierde el acceso al panel al instante', async () => {
      await get(teacherA, `/teacher/groups/${g1}/dashboard`).expect(200);
      await admin.delete(`/admin/groups/${g1}/teachers/${teacherA.userId}`).expect(204);
      for (const path of [...groupRoutes(g1), ...studentRoutes(g1, ana.userId)]) {
        const res = await get(teacherA, path);
        expect([path, res.status]).toEqual([path, 404]);
      }
      expect(
        (await get(teacherA, '/teacher/dashboard').expect(200)).body.groups.map(
          (g: { group: { id: string } }) => g.group.id,
        ),
      ).toEqual([g3]);
      await admin.post(`/admin/groups/${g1}/teachers`).send({ teacherId: teacherA.userId }).expect(201);
      await get(teacherA, `/teacher/groups/${g1}/dashboard`).expect(200);
    });

    it('un estudiante retirado del grupo deja de ser visible y de contar en los totales (y vuelve al reincorporarse)', async () => {
      await teacherA.delete(`/teacher/groups/${g1}/students/${ana.userId}`).expect(204);
      for (const path of studentRoutes(g1, ana.userId)) {
        const res = await get(teacherA, path);
        expect([path, res.status]).toEqual([path, 404]);
      }
      const dash = await get(teacherA, `/teacher/groups/${g1}/dashboard`).expect(200);
      expect(dash.body.activity).toMatchObject({ studentCount: 2, totals: { points: 100, attempts: 8 } });
      expect(
        JSON.stringify((await get(teacherA, `/teacher/groups/${g1}/dashboard/students`).expect(200)).body),
      ).not.toContain(ana.userId);

      await teacherA.post(`/teacher/groups/${g1}/students`).send({ studentId: ana.userId }).expect(201);
      const back = await get(teacherA, `/teacher/groups/${g1}/dashboard`).expect(200);
      expect(back.body.activity).toMatchObject({ studentCount: 3, totals: { points: 350, attempts: 11 } });
    });
  });

  describe('rendimiento de consultas', () => {
    it('el número de sentencias SQL no crece con el número de estudiantes (sin N+1)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Client } = require('pg') as typeof import('pg');
      const spy = jest.spyOn(Client.prototype, 'query');
      const count = async (path: string) => {
        spy.mockClear();
        await get(teacherA, path).expect(200);
        return spy.mock.calls.length;
      };
      const paths = [
        `/teacher/groups/${g1}/dashboard`,
        `/teacher/groups/${g1}/dashboard/students?limit=100`,
        `/teacher/groups/${g1}/statistics`,
        '/teacher/dashboard',
      ];
      const before = await Promise.all(paths.map(() => 0));
      for (let i = 0; i < paths.length; i++) before[i] = await count(paths[i]);

      const extra = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          Player.register(ctx, `extra${i}@example.com`, UserRole.STUDENT, `Extra ${i}`),
        ),
      );
      for (const s of extra) await enrollStudent(ctx.prisma, g1, s.userId);
      for (let i = 0; i < paths.length; i++)
        expect([paths[i], await count(paths[i])]).toEqual([paths[i], before[i]]);
      spy.mockRestore();

      const page = await get(teacherA, `/teacher/groups/${g1}/dashboard/students?limit=100`).expect(200);
      expect(page.body.items).toHaveLength(15);
      await ctx.prisma.groupMembership.deleteMany({ where: { userId: { in: extra.map((e) => e.userId) } } });
    });
  });

  describe('actividad reciente (ventana de 7 días, reloj del servidor)', () => {
    it('los estudiantes dejan de contar como activos al pasar la ventana, sin perder la actividad histórica', async () => {
      const before = await get(teacherA, `/teacher/groups/${g1}/dashboard`).expect(200);
      expect(before.body.activity).toMatchObject({ studentsWithActivity: 2, activeStudentsLast7Days: 2 });
      expect(before.body.activity.lastActivityAt).toEqual(expect.any(String));

      ctx.clock.advanceSeconds(8 * 24 * 3600);
      const login = await ctx
        .http()
        .post('/api/auth/login')
        .send({ email: 'profa@example.com', password: 'correct-horse-battery' })
        .expect(200);
      const after = await ctx
        .http()
        .get(`/api/teacher/groups/${g1}/dashboard`)
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(after.body.activity).toMatchObject({ studentsWithActivity: 2, activeStudentsLast7Days: 0 });
      expect(after.body.activity.lastActivityAt).toBe(before.body.activity.lastActivityAt);
    });
  });
});
