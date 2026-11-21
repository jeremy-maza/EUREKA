-- Persistencia del flujo de juego: claves de reto, mundo en intentos, estadísticas por mundo
-- y garantías de integridad (índices únicos parciales, CHECKs y libro de puntos solo-inserción).

-- ───────────── challenges.key (con backfill para filas existentes) ─────────────
ALTER TABLE "challenges" ADD COLUMN "key" TEXT;
UPDATE "challenges" c
   SET "key" = w."slug" || '-' || lpad(c."position"::text, 3, '0')
  FROM "worlds" w
 WHERE w."id" = c."worldId";
ALTER TABLE "challenges" ALTER COLUMN "key" SET NOT NULL;
CREATE UNIQUE INDEX "challenges_worldId_key_key" ON "challenges"("worldId", "key");

-- ───────────── challenge_attempts.worldId / elapsedMs ─────────────
ALTER TABLE "challenge_attempts" ADD COLUMN "elapsedMs" INTEGER;
ALTER TABLE "challenge_attempts" ADD COLUMN "resultMessage" TEXT;
ALTER TABLE "challenge_attempts" ADD COLUMN "unlockedRuleKey" TEXT;
ALTER TABLE "challenge_attempts" ADD COLUMN "worldId" UUID;
UPDATE "challenge_attempts" a
   SET "worldId" = c."worldId"
  FROM "challenges" c
 WHERE c."id" = a."challengeId";
ALTER TABLE "challenge_attempts" ALTER COLUMN "worldId" SET NOT NULL;
CREATE INDEX "challenge_attempts_userId_worldId_startedAt_idx" ON "challenge_attempts"("userId", "worldId", "startedAt");
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── world_statistics ─────────────
CREATE TABLE "world_statistics" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "worldId" UUID NOT NULL,
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectCount" INTEGER NOT NULL DEFAULT 0,
    "timeoutCount" INTEGER NOT NULL DEFAULT 0,
    "totalCorrectElapsedMs" INTEGER NOT NULL DEFAULT 0,
    "ruleViolationCounts" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "world_statistics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "world_statistics_userId_worldId_key" ON "world_statistics"("userId", "worldId");
ALTER TABLE "world_statistics" ADD CONSTRAINT "world_statistics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "world_statistics" ADD CONSTRAINT "world_statistics_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════ Integridad que Prisma no expresa (SQL manual) ═════════════════

-- Un único intento PENDING por (usuario, mundo): un solo intento abierto a la vez.
CREATE UNIQUE INDEX "challenge_attempts_one_pending_per_user_world"
    ON "challenge_attempts"("userId", "worldId") WHERE "outcome" = 'PENDING';

-- Una única sesión abierta por (usuario, mundo).
CREATE UNIQUE INDEX "game_sessions_one_open_per_user_world"
    ON "game_sessions"("userId", "worldId") WHERE "endedAt" IS NULL;

-- Coherencia de los intentos: resultado ↔ motivo de fallo ↔ puntos.
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_outcome_consistency" CHECK (
    (("outcome" IN ('PENDING', 'CORRECT')) AND "failureReason" IS NULL)
 OR ("outcome" = 'INCORRECT' AND "failureReason" IS NOT NULL AND "failureReason" <> 'TIMEOUT')
 OR ("outcome" = 'TIMEOUT' AND "failureReason" = 'TIMEOUT')
);
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_points_only_if_correct" CHECK (
    "pointsAwarded" >= 0 AND ("outcome" = 'CORRECT' OR "pointsAwarded" = 0)
);
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_positive_time_limit" CHECK ("timeLimitSeconds" > 0);

-- Progreso: nunca valores negativos; la mejor racha no baja de la actual; los puntos jamás decrecen por debajo de 0.
ALTER TABLE "student_world_progress" ADD CONSTRAINT "student_world_progress_valid_values" CHECK (
    "currentPosition" >= 1 AND "currentStreak" >= 0 AND "bestStreak" >= "currentStreak" AND "totalPoints" >= 0
);

-- Libro de puntos: valores no negativos…
ALTER TABLE "score_transactions" ADD CONSTRAINT "score_transactions_valid_values" CHECK (
    "basePoints" >= 0 AND "multiplierMilli" >= 0 AND "points" >= 0 AND "streakAfter" >= 0
);

-- …y solo-inserción: ninguna fila puede modificarse ni borrarse (auditabilidad).
CREATE FUNCTION forbid_score_transaction_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'score_transactions es un libro de solo inserción (% no permitido)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER score_transactions_append_only
    BEFORE UPDATE OR DELETE ON "score_transactions"
    FOR EACH ROW EXECUTE FUNCTION forbid_score_transaction_mutation();
