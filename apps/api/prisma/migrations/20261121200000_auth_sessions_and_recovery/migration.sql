-- Sesiones JWT revocables, recuperación de contraseña y limitación de intentos de autenticación.
-- Es puramente ADITIVA: crea tablas/enums nuevos y no modifica ni borra ninguna fila ni columna existente.
-- Los tokens JWT emitidos antes de esta migración carecen de `jti` y dejan de ser válidos (los usuarios
-- vuelven a iniciar sesión); ninguna cuenta ni dato de juego se ve afectado.

-- CreateEnum
CREATE TYPE "SessionRevocationReason" AS ENUM ('LOGOUT', 'LOGOUT_ALL', 'SESSION_REVOKED', 'PASSWORD_CHANGED', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "ThrottleScope" AS ENUM ('LOGIN_IP', 'LOGIN_EMAIL', 'LOGIN_IP_EMAIL', 'PASSWORD_CHANGE_USER', 'PASSWORD_RESET_REQUEST_IP');

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" "SessionRevocationReason",
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_throttles" (
    "scope" "ThrottleScope" NOT NULL,
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "lockLevel" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_throttles_pkey" PRIMARY KEY ("scope","key")
);

-- CreateIndex
CREATE INDEX "auth_sessions_userId_createdAt_idx" ON "auth_sessions"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "auth_sessions_expiresAt_idx" ON "auth_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "auth_throttles_lastAttemptAt_idx" ON "auth_throttles"("lastAttemptAt");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───────────── Invariantes que Prisma no puede expresar ─────────────

-- Una sesión revocada siempre tiene motivo, y una vigente nunca lo tiene.
ALTER TABLE "auth_sessions"
    ADD CONSTRAINT "auth_sessions_revocation_consistent"
    CHECK (("revokedAt" IS NULL) = ("revocationReason" IS NULL));

ALTER TABLE "auth_sessions"
    ADD CONSTRAINT "auth_sessions_expires_after_creation" CHECK ("expiresAt" > "createdAt");

-- Un token no puede estar a la vez consumido e invalidado, ni caducar antes de crearse.
ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_single_outcome"
    CHECK ("consumedAt" IS NULL OR "invalidatedAt" IS NULL);

ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_expires_after_creation" CHECK ("expiresAt" > "createdAt");

-- A lo sumo UN token de recuperación pendiente (ni consumido ni invalidado) por usuario, aunque lleguen
-- solicitudes concurrentes: la segunda inserción viola el índice en lugar de crear un segundo token válido.
CREATE UNIQUE INDEX "password_reset_tokens_one_pending_per_user"
    ON "password_reset_tokens"("userId")
    WHERE "consumedAt" IS NULL AND "invalidatedAt" IS NULL;

ALTER TABLE "auth_throttles"
    ADD CONSTRAINT "auth_throttles_non_negative" CHECK ("attempts" >= 0 AND "lockLevel" >= 0);
