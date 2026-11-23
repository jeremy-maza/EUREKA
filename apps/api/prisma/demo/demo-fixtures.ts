/**
 * Datos de demostración REPRODUCIBLES (solo desarrollo). Ver `docs/demo.md`.
 *
 * Garantías:
 *  - Solo toca cuentas cuyo correo termina en `@demo.eureka.local` (y el grupo demo que ellas crearon):
 *    nunca lee, modifica ni borra datos de usuarios reales.
 *  - Se niega a ejecutarse con `NODE_ENV=production`.
 *  - Los datos se generan JUGANDO contra el motor real (`GameService`, planificador de secuencias real) con un reloj
 *    retrasado, de modo que secuencias, intentos, libro de puntos, estadísticas y reglas dominadas son los del juego.
 *    Como oráculo de respuestas se usa la solución de referencia que el propio generador guardó con cada reto.
 *  - Es determinista: semillas fijas por escenario ⇒ mismas secuencias, respuestas y resultados en cada ejecución
 *    (solo cambian los ids y las marcas de tiempo, que se calculan relativas a `now`).
 *  - Es idempotente: `seedDemoData` borra primero los datos demo anteriores.
 */
import { PrismaClient, UserRole } from '../../src/generated/prisma/client';
import { PasswordHasher } from '../../src/modules/auth/password-hasher';
import { SequentialSeedSource } from '../../src/common/seed-source';
import { GameService } from '../../src/modules/game/game.service';
import { ALL_WORLDS } from '../../src/modules/worlds/catalog';
import { createDemoGameService, DemoClock } from './demo-game';

export const DEMO_EMAIL_DOMAIN = 'demo.eureka.local';
export const DEMO_GROUP_NAME = 'Grupo Demo (datos de demostración)';
export const DEFAULT_DEMO_PASSWORD = 'demo-eureka-2026';
/** Mundos en orden de desbloqueo (1 = Aritmética … 5 = Caos matemático). */
export const WORLD_SLUGS = ALL_WORLDS.map((world) => world.slug);
export const WORLD_SLUG = WORLD_SLUGS[0];

export type DemoScenarioId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

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
    description: 'Sin progreso, puntos ni racha. Solo el Mundo 1 está desbloqueado.',
  },
  {
    scenario: 'B',
    email: email('demo.b.progreso'),
    displayName: 'Demo B · Progreso',
    role: UserRole.STUDENT,
    description:
      'Mundo 1: 3 aciertos seguidos (450 puntos, racha 3, 2 reglas dominadas); el reto 4 de su secuencia está por empezar.',
  },
  {
    scenario: 'C',
    email: email('demo.c.fallo'),
    displayName: 'Demo C · Secuencia fallida',
    role: UserRole.STUDENT,
    description:
      'Mundo 1: tenía 3 aciertos (450 puntos) y falló el reto 4 rompiendo reglas: racha 0, conserva los puntos; la próxima secuencia sorteará reglas nuevas.',
  },
  {
    scenario: 'D',
    email: email('demo.d.avanzado'),
    displayName: 'Demo D · Avanzado',
    role: UserRole.STUDENT,
    description:
      'Completó el Mundo 1 dos veces (la segunda en dificultad intensa): 2 700 puntos, racha 9, el próximo acierto vale ×5; también completó el Mundo 2, así que tiene el Mundo 3 desbloqueado.',
  },
  {
    scenario: 'E',
    email: email('demo.e.expirado'),
    displayName: 'Demo E · Reto expirado',
    role: UserRole.STUDENT,
    description:
      'Mundo 1: dejó el reto 3 sin responder y su plazo venció; al entrar, el servidor lo cierra por TIMEOUT (racha 0, conserva 250 puntos).',
  },
  {
    scenario: 'F',
    email: email('demo.f.explorador'),
    displayName: 'Demo F · Explorador',
    role: UserRole.STUDENT,
    description:
      'Completó los Mundos 1 a 4 (700 puntos en cada uno): el Mundo 5 (Caos matemático) está desbloqueado.',
  },
  {
    scenario: 'DOCENTE',
    email: email('demo.docente'),
    displayName: 'Demo · Docente',
    role: UserRole.TEACHER,
    description: 'Docente del grupo demo: ve a los seis estudiantes demo en el panel y en la clasificación.',
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

const SECONDS_PER_ANSWER = 8;
const MINUTES = 60_000;
/** Semilla inicial de las secuencias de cada escenario (deterministas y distintas entre escenarios). */
const SEED_BASE: Record<DemoScenarioId, number> = {
  A: 1_000,
  B: 2_000,
  C: 3_000,
  D: 4_000,
  E: 5_000,
  F: 6_000,
};

export async function seedDemoData(
  prisma: PrismaClient,
  options: SeedDemoOptions = {},
): Promise<SeedDemoResult> {
  const env = options.env ?? process.env;
  assertDemoAllowed(env);
  const now = options.now ?? new Date();
  const password = options.password ?? env.DEMO_PASSWORD ?? DEFAULT_DEMO_PASSWORD;

  const seeded = await prisma.world.findMany({
    where: { slug: { in: WORLD_SLUGS } },
    select: { slug: true },
  });
  const missing = WORLD_SLUGS.filter((slug) => !seeded.some((world) => world.slug === slug));
  if (missing.length > 0) {
    throw new Error(
      `Faltan mundos en la base de datos (${missing.join(', ')}). Ejecuta primero: npm run db:seed`,
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
  // Un servicio por escenario: cada uno con su propia serie de semillas, independiente del orden de ejecución.
  const games = new Map<DemoScenarioId, GameService>();
  const gameFor = (scenario: DemoScenarioId): GameService => {
    let game = games.get(scenario);
    if (!game) {
      game = createDemoGameService(prisma, clock, new SequentialSeedSource(SEED_BASE[scenario]), env);
      games.set(scenario, game);
    }
    return game;
  };

  /** Reto generado del intento (el oráculo de respuestas es la solución que guardó el generador). */
  const challengeOf = async (attemptId: string) =>
    (
      await prisma.challengeAttempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: { sequenceChallenge: true },
      })
    ).sequenceChallenge!;

  /** Juega un reto completo (iniciar, «pensar» unos segundos, responder) y comprueba el resultado esperado. */
  const play = async (
    scenario: DemoScenarioId,
    sessionId: string,
    answer: 'SOLVE' | 'BREAK_RULES',
    expected: Expected,
  ) => {
    const game = gameFor(scenario);
    const attempt = await game.startAttempt(userId(scenario), sessionId);
    const challenge = await challengeOf(attempt.attemptId);
    // Romper reglas: desde el reto 2 el generador garantiza que enviar el enunciado tal cual viola alguna regla.
    const expression = answer === 'SOLVE' ? challenge.referenceSolution : challenge.expression;
    clock.advanceSeconds(SECONDS_PER_ANSWER);
    const result = await game.submitAnswer(userId(scenario), attempt.attemptId, expression);
    if (result.outcome !== expected) {
      throw new Error(
        `Fixture ${scenario}: se esperaba ${expected} con "${expression}" pero el motor devolvió ${result.outcome}.`,
      );
    }
    return result;
  };
  const openSession = async (scenario: DemoScenarioId, world = WORLD_SLUG) =>
    (await gameFor(scenario).startSession(userId(scenario), world)).session.id;
  const playCorrect = async (scenario: DemoScenarioId, sessionId: string, count: number) => {
    for (let index = 0; index < count; index += 1) await play(scenario, sessionId, 'SOLVE', 'CORRECT');
  };
  /** Completa la secuencia entera de una sesión nueva en `world`. */
  const completeWorld = async (scenario: DemoScenarioId, world: string) => {
    const sessionId = await openSession(scenario, world);
    for (;;) {
      const result = await play(scenario, sessionId, 'SOLVE', 'CORRECT');
      if (result.worldCompleted) return result;
    }
  };

  // ── A · Jugador nuevo: sin filas de progreso ni sesiones. ──

  // ── B · Progreso: 3 aciertos en el Mundo 1; el reto 4 sin empezar. ──
  clock.set(new Date(now.getTime() - 60 * MINUTES));
  await playCorrect('B', await openSession('B'), 3);

  // ── C · Secuencia fallida: 3 aciertos y fallo por reglas en el reto 4. ──
  clock.set(new Date(now.getTime() - 50 * MINUTES));
  const sessionC = await openSession('C');
  await playCorrect('C', sessionC, 3);
  const failed = await play('C', sessionC, 'BREAK_RULES', 'INCORRECT');
  if (failed.failureReason !== 'RULE_VIOLATION') {
    throw new Error(`Fixture C: se esperaba RULE_VIOLATION y fue ${failed.failureReason}.`);
  }

  // ── D · Avanzado: Mundo 1 completado dos veces seguidas (racha 9, ×5) y Mundo 2 completado. ──
  clock.set(new Date(now.getTime() - 40 * MINUTES));
  await completeWorld('D', WORLD_SLUGS[0]); // completar cierra la sesión
  clock.advanceSeconds(30);
  await completeWorld('D', WORLD_SLUGS[0]); // nueva sesión: secuencia nueva, conserva puntos y racha
  clock.advanceSeconds(30);
  const unlocked = await completeWorld('D', WORLD_SLUGS[1]);
  if (unlocked.nextWorldUnlocked?.slug !== WORLD_SLUGS[2]) {
    throw new Error('Fixture D: completar el Mundo 2 debería desbloquear el Mundo 3.');
  }

  // ── E · Reto expirado: reto 3 abierto hace 12 min y sin respuesta. Lo cierra el servidor al entrar. ──
  clock.set(new Date(now.getTime() - 12 * MINUTES));
  const sessionE = await openSession('E');
  await playCorrect('E', sessionE, 2);
  const abandoned = await gameFor('E').startAttempt(userId('E'), sessionE);
  if (abandoned.position !== 3 || abandoned.deadlineAt.getTime() >= now.getTime()) {
    throw new Error('Fixture E: el reto abandonado debería ser el 3 y estar vencido respecto a `now`.');
  }

  // ── F · Explorador: Mundos 1–4 completados, el Mundo 5 desbloqueado. ──
  clock.set(new Date(now.getTime() - 30 * MINUTES));
  for (const world of WORLD_SLUGS.slice(0, 4)) {
    await completeWorld('F', world);
    clock.advanceSeconds(30);
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
  for (const scenario of ['A', 'B', 'C', 'D', 'E', 'F'] as const) {
    await prisma.groupMembership.create({
      data: { groupId: group.id, userId: userId(scenario), addedById: userId('DOCENTE') },
    });
  }

  return { password, accounts: DEMO_ACCOUNTS, reset };
}
