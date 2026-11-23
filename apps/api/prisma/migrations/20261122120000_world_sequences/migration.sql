-- Cinco mundos con secuencias generadas: cada secuencia sortea un subconjunto de reglas del mundo y su orden, y
-- guarda los retos generados. Migración ADITIVA: no se borra ninguna tabla, columna ni fila.
-- Decisiones: EUREKA_MASTER_PLAN.md §3 (D1–D3) y docs/architecture.md.

-- ───────────── Enums ─────────────
CREATE TYPE "SequenceStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'FAILED');
CREATE TYPE "DifficultyLevel" AS ENUM ('EASIER', 'BASELINE', 'HARDER');

-- ───────────── Progreso: compleciones (desbloquean el mundo siguiente) ─────────────
ALTER TABLE "student_world_progress" ADD COLUMN "completionsCount" INTEGER NOT NULL DEFAULT 0,
                                     ADD COLUMN "firstCompletedAt" TIMESTAMP(3);

-- ───────────── Secuencias y retos generados ─────────────
CREATE TABLE "game_sequences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "worldId" UUID NOT NULL,
    "seed" INTEGER NOT NULL,
    "difficulty" "DifficultyLevel" NOT NULL,
    "ruleKeys" TEXT[],
    "generatorVersion" TEXT NOT NULL,
    "status" "SequenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "game_sequences_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "game_sequences_userId_worldId_startedAt_idx" ON "game_sequences"("userId", "worldId", "startedAt");
ALTER TABLE "game_sequences" ADD CONSTRAINT "game_sequences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "game_sequences" ADD CONSTRAINT "game_sequences_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sequence_challenges" (
    "id" UUID NOT NULL,
    "sequenceId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "statementKind" TEXT NOT NULL DEFAULT 'EXPRESSION',
    "expression" TEXT NOT NULL,
    "expectedResult" TEXT NOT NULL,
    "referenceSolution" TEXT NOT NULL,
    "introducesRuleKey" TEXT,
    "fingerprint" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,

    CONSTRAINT "sequence_challenges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sequence_challenges_sequenceId_position_key" ON "sequence_challenges"("sequenceId", "position");
ALTER TABLE "sequence_challenges" ADD CONSTRAINT "sequence_challenges_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "game_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── Intentos: reto generado + instantánea (posición y enunciado) ─────────────
ALTER TABLE "challenge_attempts" ADD COLUMN "sequenceChallengeId" UUID,
                                 ADD COLUMN "position" INTEGER,
                                 ADD COLUMN "expression" TEXT,
                                 ALTER COLUMN "challengeId" DROP NOT NULL;
UPDATE "challenge_attempts" a
   SET "position" = c."position", "expression" = c."expression"
  FROM "challenges" c
 WHERE c."id" = a."challengeId";
ALTER TABLE "challenge_attempts" ALTER COLUMN "position" SET NOT NULL,
                                 ALTER COLUMN "expression" SET NOT NULL;
CREATE INDEX "challenge_attempts_sequenceChallengeId_idx" ON "challenge_attempts"("sequenceChallengeId");
-- NO ACTION (no RESTRICT): se comprueba al final de la sentencia, así el borrado en cascada de un usuario funciona.
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_sequenceChallengeId_fkey" FOREIGN KEY ("sequenceChallengeId") REFERENCES "sequence_challenges"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- ───────────── Backfill de compleciones a partir del historial ─────────────
-- Una compleción = un acierto en el último reto del catálogo fijo del mundo.
WITH last_position AS (
    SELECT "worldId", max("position") AS "position" FROM "challenges" GROUP BY "worldId"
), completions AS (
    SELECT a."userId", a."worldId", count(*)::int AS n, min(a."submittedAt") AS first_at
      FROM "challenge_attempts" a
      JOIN last_position l ON l."worldId" = a."worldId" AND l."position" = a."position"
     WHERE a."outcome" = 'CORRECT'
     GROUP BY a."userId", a."worldId"
)
UPDATE "student_world_progress" p
   SET "completionsCount" = c.n, "firstCompletedAt" = c.first_at
  FROM completions c
 WHERE c."userId" = p."userId" AND c."worldId" = p."worldId";
-- Progreso marcado como completado sin intento que lo respalde (datos sembrados a mano): cuenta como una compleción.
UPDATE "student_world_progress"
   SET "completionsCount" = 1, "firstCompletedAt" = COALESCE("firstCompletedAt", "updatedAt")
 WHERE "status" = 'COMPLETED' AND "completionsCount" = 0;

-- ───────────── Transición desde el catálogo fijo ─────────────
-- Los retos del catálogo fijo ya no se presentan. Un intento antiguo aún abierto se cierra como TIMEOUT (no se puede
-- evaluar contra el catálogo nuevo) y la secuencia en curso vuelve al reto 1; la próxima partida sortea una secuencia
-- nueva. Puntos, rachas, reglas dominadas e historial se conservan.
UPDATE "challenge_attempts"
   SET "outcome" = 'TIMEOUT', "failureReason" = 'TIMEOUT',
       "elapsedMs" = "timeLimitSeconds" * 1000,
       "resultMessage" = 'Reto cerrado por la actualización del juego (nuevas secuencias).'
 WHERE "outcome" = 'PENDING' AND "sequenceChallengeId" IS NULL;
UPDATE "student_world_progress" SET "currentPosition" = 1 WHERE "status" = 'IN_PROGRESS';

-- ═════════════════ Integridad que Prisma no expresa (SQL manual) ═════════════════

-- Una única secuencia ACTIVE por (usuario, mundo).
CREATE UNIQUE INDEX "game_sequences_one_active_per_user_world"
    ON "game_sequences"("userId", "worldId") WHERE "status" = 'ACTIVE';

-- Una secuencia activa no tiene fin; una cerrada sí.
ALTER TABLE "game_sequences" ADD CONSTRAINT "game_sequences_status_consistency" CHECK (
    ("status" = 'ACTIVE' AND "endedAt" IS NULL) OR ("status" <> 'ACTIVE' AND "endedAt" IS NOT NULL)
);
ALTER TABLE "game_sequences" ADD CONSTRAINT "game_sequences_valid_seed" CHECK ("seed" >= 0);
ALTER TABLE "sequence_challenges" ADD CONSTRAINT "sequence_challenges_valid_values" CHECK (
    "position" >= 1 AND "statementKind" IN ('EXPRESSION', 'EQUATION')
    AND (("position" = 1) = ("introducesRuleKey" IS NULL))
);

-- Todo intento referencia un reto: del catálogo fijo (histórico) o generado (nuevo).
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_has_challenge" CHECK (
    "challengeId" IS NOT NULL OR "sequenceChallengeId" IS NOT NULL
);
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_valid_position" CHECK ("position" >= 1);

ALTER TABLE "student_world_progress" ADD CONSTRAINT "student_world_progress_valid_completions" CHECK (
    "completionsCount" >= 0 AND (("completionsCount" = 0) = ("firstCompletedAt" IS NULL))
);
