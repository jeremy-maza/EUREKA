/**
 * Datos de demostración REPRODUCIBLES (solo desarrollo). Ver `docs/demo.md`.
 *
 * Garantías:
 *  - Solo toca cuentas cuyo correo termina en `@demo.eureka.local` (y el grupo demo que ellas crearon):
 *    nunca lee, modifica ni borra datos de usuarios reales.
 *  - Se niega a ejecutarse con `NODE_ENV=production`.
 *  - Los datos se generan JUGANDO contra el motor real (`GameService`) con un reloj retrasado, de modo que
 *    intentos, libro de puntos, estadísticas y reglas desbloqueadas son los que produciría el juego.
 *  - Es determinista: mismas cuentas, mismas respuestas y mismos resultados en cada ejecución
 *    (solo cambian los ids y las marcas de tiempo, que se calculan relativas a `now`).
 *  - Es idempotente: `seedDemoData` borra primero los datos demo anteriores.
 */
import { PrismaClient, UserRole } from '../../src/generated/prisma/client';
import { PasswordHasher } from '../../src/modules/auth/password-hasher';
import { arithmeticWorld } from '../../src/modules/worlds/catalog/arithmetic.world';
import { createDemoGameService, DemoClock } from './demo-game';

export const DEMO_EMAIL_DOMAIN = 'demo.eureka.local';
export const DEMO_GROUP_NAME = 'Grupo Demo (datos de demostración)';
export const DEFAULT_DEMO_PASSWORD = 'demo-eureka-2026';
export const WORLD_SLUG = arithmeticWorld.slug;

export type DemoScenarioId = 'A' | 'B' | 'C' | 'D' | 'E';

export interface DemoAccount {
  scenario: DemoScenarioId | 'DOCENTE';
  email: string;
  displayName: string;
  role: UserRole;
  description: string;
}

const email = (local: string) => `${local}@${DEMO_EMAIL_DOMAIN}`;

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    scenario: 'A',
    email: email('demo.a.nuevo'),
    displayName: 'Demo A · Jugador nuevo',
    role: UserRole.STUDENT,
    description: 'Sin progreso, puntos ni racha. Listo para empezar el Mundo 1.',
  },
  {
    scenario: 'B',
    email: email('demo.b.progreso'),
    displayName: 'Demo B · Progreso',
    role: UserRole.STUDENT,
    description:
      '3 aciertos seguidos: 450 puntos, racha 3, 2 reglas desbloqueadas; el reto 4 está por empezar.',
  },
  {
    scenario: 'C',
    email: email('demo.c.fallo'),
    displayName: 'Demo C · Secuencia fallida',
    role: UserRole.STUDENT,
    description:
      'Tenía 3 aciertos (450 puntos) y falló el reto 4 (valor correcto pero rompe reglas activas): racha 0, conserva puntos y 2 reglas.',
  },
  {
    scenario: 'D',
    email: email('demo.d.avanzado'),
    displayName: 'Demo D · Avanzado',
    role: UserRole.STUDENT,
    description:
      'Completó el Mundo 1 dos veces seguidas: 2 200 puntos, racha 8, 3 reglas y el próximo acierto ya vale ×5 (tope).',
  },
  {
    scenario: 'E',
    email: email('demo.e.expirado'),
    displayName: 'Demo E · Reto expirado',
    role: UserRole.STUDENT,
    description:
      'Dejó el reto 3 sin responder y su plazo venció: al entrar, el servidor lo cierra por TIMEOUT (racha 0, conserva 250 puntos y 1 regla).',
  },
  {
    scenario: 'DOCENTE',
    email: email('demo.docente'),
    displayName: 'Demo · Docente',
    role: UserRole.TEACHER,
    description: 'Docente del grupo demo: ve a los cinco estudiantes demo en el panel y en la clasificación.',
  },
];

/** Se niega a operar en producción: los fixtures nunca deben llegar a una base de datos real. */
export function assertDemoAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Los datos de demostración están deshabilitados con NODE_ENV=production.');
  }
}

export interface DemoResetSummary {
  users: number;
  groups: number;
  /** Grupos demo conservados porque tienen miembros que no son cuentas demo. */
  groupsKept: number;
}

const LEDGER_TRIGGER = 'score_transactions_append_only';

/**
 * Elimina SOLO las cuentas demo y lo que cuelga de ellas.
 *
 * El libro de puntos es de solo inserción (trigger) y referencia al usuario con RESTRICT, así que para
 * borrar cuentas demo hay que desactivar el trigger. Se hace dentro de UNA transacción (el DDL es
 * transaccional en PostgreSQL: si algo falla, el trigger queda activo) y el DELETE está acotado a los ids demo.
 */
export async function resetDemoData(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DemoResetSummary> {
  assertDemoAllowed(env);
  const demoUsers = await prisma.user.findMany({
    where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  const ids = demoUsers.map((user) => user.id);
  if (ids.length === 0) return { users: 0, groups: 0, groupsKept: 0 };

  return prisma.$transaction(
    async (tx) => {
      const groups = await tx.group.findMany({
        where: { name: DEMO_GROUP_NAME, createdById: { in: ids } },
        select: { id: true, memberships: { select: { userId: true } } },
      });
      const removable = groups.filter((group) => group.memberships.every((m) => ids.includes(m.userId)));
      await tx.group.deleteMany({ where: { id: { in: removable.map((group) => group.id) } } });

      await tx.$executeRawUnsafe(`ALTER TABLE "score_transactions" DISABLE TRIGGER ${LEDGER_TRIGGER}`);
      await tx.scoreTransaction.deleteMany({ where: { userId: { in: ids } } });
      await tx.$executeRawUnsafe(`ALTER TABLE "score_transactions" ENABLE TRIGGER ${LEDGER_TRIGGER}`);

      // Cascada: sesiones de auth, progreso, reglas desbloqueadas, sesiones de juego, intentos, estadísticas y membresías.
      const deleted = await tx.user.deleteMany({ where: { id: { in: ids } } });
      return { users: deleted.count, groups: removable.length, groupsKept: groups.length - removable.length };
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

export interface SeedDemoOptions {
  /** Instante «actual»: el historial se coloca antes y el reto del escenario E vence antes de este instante. */
  now?: Date;
  /** Contraseña común de las cuentas demo (por defecto `DEMO_PASSWORD` o la de `DEFAULT_DEMO_PASSWORD`). */
  password?: string;
  env?: NodeJS.ProcessEnv;
}

export interface SeedDemoResult {
  password: string;
  accounts: readonly DemoAccount[];
  reset: DemoResetSummary;
}

type Expected = 'CORRECT' | 'INCORRECT';

/** Respuestas de referencia del catálogo: cumplen TODAS las reglas a la vez (válidas en cualquier punto). */
const SOLUTIONS = arithmeticWorld.challenges.map((challenge) => challenge.referenceSolution);
/** El reto 4 (`5 * 8`) vale 40 pero usa el 5 que él mismo prohíbe y no contiene `7 * 1`: acierta el valor, rompe reglas. */
const RULE_BREAKING_ANSWER_FOR_CHALLENGE_4 = arithmeticWorld.challenges[3].expression;

const SECONDS_PER_ANSWER = 8;
const MINUTES = 60_000;

export async function seedDemoData(
  prisma: PrismaClient,
  options: SeedDemoOptions = {},
): Promise<SeedDemoResult> {
  const env = options.env ?? process.env;
  assertDemoAllowed(env);
  const now = options.now ?? new Date();
  const password = options.password ?? env.DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD;

  const world = await prisma.world.findUnique({ where: { slug: WORLD_SLUG } });
  if (!world) {
    throw new Error(
      `No existe el mundo "${WORLD_SLUG}" en la base de datos. Ejecuta primero: npm run db:seed`,
    );
  }

  const reset = await resetDemoData(prisma, env);

  const passwordHash = await new PasswordHasher().hash(password);
  const users = new Map<DemoAccount['scenario'], string>();
  for (const account of DEMO_ACCOUNTS) {
    const user = await prisma.user.create({
      data: { email: account.email, displayName: account.displayName, passwordHash, role: account.role },
    });
    users.set(account.scenario, user.id);
  }
  const userId = (scenario: DemoAccount['scenario']): string => users.get(scenario)!;

  const clock = new DemoClock(now);
  const game = createDemoGameService(prisma, clock, env);

  /** Juega un reto completo (iniciar, «pensar» unos segundos, responder) y comprueba el resultado esperado. */
  const play = async (
    scenario: DemoScenarioId,
    sessionId: string,
    expression: string,
    expected: Expected,
  ) => {
    const attempt = await game.startAttempt(userId(scenario), sessionId);
    clock.advanceSeconds(SECONDS_PER_ANSWER);
    const result = await game.submitAnswer(userId(scenario), attempt.attemptId, expression);
    if (result.outcome !== expected) {
      throw new Error(
        `Fixture ${scenario}: se esperaba ${expected} con "${expression}" pero el motor devolvió ${result.outcome}. ` +
          'Revisa si el catálogo del mundo cambió.',
      );
    }
    return result;
  };
  const openSession = async (scenario: DemoScenarioId) =>
    (await game.startSession(userId(scenario), WORLD_SLUG)).session.id;
  const playCorrect = async (scenario: DemoScenarioId, sessionId: string, challengeCount: number) => {
    for (let index = 0; index < challengeCount; index += 1) {
      await play(scenario, sessionId, SOLUTIONS[index], 'CORRECT');
    }
  };

  // ── A · Jugador nuevo: sin filas de progreso ni sesiones. ──

  // ── B · Progreso: 3 aciertos, el reto 4 sin empezar. ──
  clock.set(new Date(now.getTime() - 60 * MINUTES));
  await playCorrect('B', await openSession('B'), 3);

  // ── C · Secuencia fallida: 3 aciertos y fallo por regla en el reto 4. ──
  clock.set(new Date(now.getTime() - 50 * MINUTES));
  const sessionC = await openSession('C');
  await playCorrect('C', sessionC, 3);
  const failed = await play('C', sessionC, RULE_BREAKING_ANSWER_FOR_CHALLENGE_4, 'INCORRECT');
  if (failed.failureReason !== 'RULE_VIOLATION') {
    throw new Error(`Fixture C: se esperaba RULE_VIOLATION y fue ${failed.failureReason}.`);
  }

  // ── D · Avanzado: el mundo completado dos veces seguidas (racha 8, el siguiente acierto ya vale ×5). ──
  clock.set(new Date(now.getTime() - 40 * MINUTES));
  await playCorrect('D', await openSession('D'), arithmeticWorld.challenges.length); // completar cierra la sesión
  clock.advanceSeconds(30);
  await playCorrect('D', await openSession('D'), arithmeticWorld.challenges.length); // nueva sesión: conserva reglas/racha

  // ── E · Reto expirado: reto 3 abierto hace 12 min y sin respuesta (plazo ≤ 90 s). Lo cierra el servidor al entrar. ──
  clock.set(new Date(now.getTime() - 12 * MINUTES));
  const sessionE = await openSession('E');
  await playCorrect('E', sessionE, 2);
  const abandoned = await game.startAttempt(userId('E'), sessionE);
  if (abandoned.position !== 3 || abandoned.deadlineAt.getTime() >= now.getTime()) {
    throw new Error('Fixture E: el reto abandonado debería ser el 3 y estar vencido respecto a `now`.');
  }

  // ── Grupo demo con docente: habilita la clasificación y el panel docente. ──
  const group = await prisma.group.create({
    data: {
      name: DEMO_GROUP_NAME,
      description: 'Datos de demostración. Se pueden regenerar o borrar con `npm run db:demo:reset`.',
      createdById: userId('DOCENTE'),
    },
  });
  await prisma.teacherGroupAssignment.create({
    data: { groupId: group.id, teacherId: userId('DOCENTE'), assignedById: userId('DOCENTE') },
  });
  for (const scenario of ['A', 'B', 'C', 'D', 'E'] as const) {
    await prisma.groupMembership.create({
      data: { groupId: group.id, userId: userId(scenario), addedById: userId('DOCENTE') },
    });
  }

  return { password, accounts: DEMO_ACCOUNTS, reset };
}
