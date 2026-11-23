import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '../../prisma/migrations');
const TARGET = '20261122120000_world_sequences';

const migrationNames = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const sql = (name: string): string => readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');

const W = '00000000-0000-7000-8000-0000000000f1';
const ANA = '00000000-0000-7000-8000-000000000002';
const BEA = '00000000-0000-7000-8000-000000000003';
const SESSION_ANA = '00000000-0000-7000-8000-0000000000c1';
const SESSION_BEA = '00000000-0000-7000-8000-0000000000c2';
const challengeId = (position: number) => `00000000-0000-7000-8000-0000000001a${position}`;

/**
 * La migración de secuencias debe aplicarse sobre una base con partidas del catálogo fijo sin perder nada: conserva
 * intentos y puntos, hace instantánea de posición/enunciado, cuenta las compleciones y cierra intentos abiertos.
 */
describe('migración world_sequences sobre una base con partidas del catálogo fijo', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    const previous = migrationNames.slice(0, migrationNames.indexOf(TARGET));
    expect(previous.length).toBeGreaterThanOrEqual(4);
    for (const name of previous) await db.exec(sql(name));

    const challenges = ['3 * 7', '3 * 7 * 2', '3 * 7 * 2 / 6', '5 * 8']
      .map(
        (expression, i) =>
          `('${challengeId(i + 1)}', '${W}', 'arithmetic-00${i + 1}', ${i + 1}, '${expression}', '1', '1')`,
      )
      .join(',\n');
    await db.exec(`
      INSERT INTO users (id, email, "displayName", "passwordHash", role, "updatedAt") VALUES
        ('${ANA}', 'ana@example.com', 'Ana', 'scrypt$x', 'STUDENT', now()),
        ('${BEA}', 'bea@example.com', 'Bea', 'scrypt$x', 'STUDENT', now());
      INSERT INTO worlds (id, slug, name, position, "isEnabled", "updatedAt") VALUES
        ('${W}', 'arithmetic', 'Aritmética', 1, true, now());
      INSERT INTO challenges (id, "worldId", key, position, expression, "expectedResult", "referenceSolution") VALUES
        ${challenges};
      INSERT INTO game_sessions (id, "userId", "worldId") VALUES
        ('${SESSION_ANA}', '${ANA}', '${W}'), ('${SESSION_BEA}', '${BEA}', '${W}');
      -- Ana completó el mundo dos veces (aciertos en el reto 4) y está en el reto 2 de una tercera pasada.
      INSERT INTO student_world_progress (id, "userId", "worldId", "currentPosition", "currentStreak", "bestStreak", "totalPoints", status, "updatedAt") VALUES
        (gen_random_uuid(), '${ANA}', '${W}', 2, 9, 9, 2700, 'IN_PROGRESS', now()),
        (gen_random_uuid(), '${BEA}', '${W}', 3, 2, 2, 250, 'IN_PROGRESS', now());
      INSERT INTO challenge_attempts (id, "sessionId", "userId", "worldId", "challengeId", outcome, "activeRuleKeys", "activeRulesCount", "timeLimitSeconds", "startedAt", "deadlineAt", "submittedAt", "streakBefore") VALUES
        (gen_random_uuid(), '${SESSION_ANA}', '${ANA}', '${W}', '${challengeId(4)}', 'CORRECT', '{}', 3, 90, '2026-01-01 10:00:00', '2026-01-01 10:01:30', '2026-01-01 10:00:10', 3),
        (gen_random_uuid(), '${SESSION_ANA}', '${ANA}', '${W}', '${challengeId(4)}', 'CORRECT', '{}', 3, 90, '2026-01-02 10:00:00', '2026-01-02 10:01:30', '2026-01-02 10:00:10', 7),
        (gen_random_uuid(), '${SESSION_ANA}', '${ANA}', '${W}', '${challengeId(1)}', 'CORRECT', '{}', 0, 60, '2026-01-03 10:00:00', '2026-01-03 10:01:00', '2026-01-03 10:00:10', 8),
        -- Bea tiene un reto 3 ABIERTO del catálogo fijo.
        (gen_random_uuid(), '${SESSION_BEA}', '${BEA}', '${W}', '${challengeId(3)}', 'PENDING', '{}', 2, 75, '2026-01-03 10:00:00', '2026-01-03 10:01:15', NULL, 2);
    `);

    await db.exec(sql(TARGET));
  });
  afterAll(() => db.close());

  const rows = async <T>(query: string): Promise<T[]> => (await db.query<T>(query)).rows;

  it('conserva todos los intentos con su reto histórico y les añade posición y enunciado', async () => {
    expect(
      await rows(
        `SELECT position, expression, ("challengeId" IS NOT NULL) AS legacy FROM challenge_attempts ORDER BY "startedAt", position`,
      ),
    ).toEqual([
      { position: 4, expression: '5 * 8', legacy: true },
      { position: 4, expression: '5 * 8', legacy: true },
      { position: 1, expression: '3 * 7', legacy: true },
      { position: 3, expression: '3 * 7 * 2 / 6', legacy: true },
    ]);
  });

  it('cuenta las compleciones a partir del historial (desbloquean el mundo siguiente)', async () => {
    expect(
      await rows(
        `SELECT "userId", "completionsCount", to_char("firstCompletedAt", 'YYYY-MM-DD HH24:MI:SS') AS "firstCompletedAt"
           FROM student_world_progress ORDER BY "userId"`,
      ),
    ).toEqual([
      // La primera compleción es el primer acierto en el último reto del catálogo fijo.
      { userId: ANA, completionsCount: 2, firstCompletedAt: '2026-01-01 10:00:10' },
      { userId: BEA, completionsCount: 0, firstCompletedAt: null },
    ]);
  });

  it('cierra el intento abierto del catálogo fijo y devuelve las secuencias en curso al reto 1, sin tocar puntos ni rachas', async () => {
    expect(
      await rows(
        `SELECT outcome, "failureReason", "elapsedMs" FROM challenge_attempts WHERE "userId" = '${BEA}'`,
      ),
    ).toEqual([{ outcome: 'TIMEOUT', failureReason: 'TIMEOUT', elapsedMs: 75_000 }]);
    expect(
      await rows(
        `SELECT "currentPosition", "currentStreak", "totalPoints" FROM student_world_progress ORDER BY "userId"`,
      ),
    ).toEqual([
      { currentPosition: 1, currentStreak: 9, totalPoints: 2700 },
      { currentPosition: 1, currentStreak: 2, totalPoints: 250 },
    ]);
  });

  it('impone los nuevos invariantes', async () => {
    // Un intento sin reto (ni histórico ni generado) se rechaza.
    await expect(
      db.exec(`INSERT INTO challenge_attempts (id, "sessionId", "userId", "worldId", outcome, "activeRuleKeys", "activeRulesCount", "timeLimitSeconds", "deadlineAt", "streakBefore", position, expression)
        VALUES (gen_random_uuid(), '${SESSION_ANA}', '${ANA}', '${W}', 'CORRECT', '{}', 0, 60, now(), 0, 1, '1')`),
    ).rejects.toThrow(/has_challenge/);
    // Una sola secuencia ACTIVE por (jugador, mundo).
    const insertSequence = `INSERT INTO game_sequences (id, "userId", "worldId", seed, difficulty, "ruleKeys", "generatorVersion")
      VALUES (gen_random_uuid(), '${ANA}', '${W}', 7, 'BASELINE', '{}', 'v')`;
    await db.exec(insertSequence);
    await expect(db.exec(insertSequence)).rejects.toThrow(/one_active/);
    // Estado ↔ fin coherentes, compleciones ↔ fecha coherentes.
    await expect(db.exec(`UPDATE game_sequences SET status = 'FAILED'`)).rejects.toThrow(
      /status_consistency/,
    );
    await expect(
      db.exec(`UPDATE student_world_progress SET "completionsCount" = 1 WHERE "userId" = '${BEA}'`),
    ).rejects.toThrow(/valid_completions/);
  });
});
