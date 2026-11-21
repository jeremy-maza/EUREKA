import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface UserActivity {
  userId: string;
  /** Intentos iniciados (de cualquier resultado) en la ventana consultada. */
  attemptsStarted: number;
  lastAttemptStartedAt: Date | null;
}

export interface CompletedChallengesRow {
  userId: string;
  worldId: string;
  /** Retos DISTINTOS acertados al menos una vez (no cuenta repeticiones tras reiniciar la secuencia). */
  distinctChallenges: number;
}

export interface FailureReasonRow {
  worldId: string;
  reason: string;
  count: number;
}

export interface ChallengeOutcomeRow {
  worldId: string;
  challengeId: string;
  attempts: number;
  correct: number;
}

export interface TrailingFailuresRow {
  userId: string;
  worldId: string;
  /** Fallos/timeouts consecutivos más recientes (se detiene en el primer acierto); acotado por `cap`. */
  consecutiveFailures: number;
}

/**
 * Agregados derivados del historial de intentos (`ChallengeAttempt`, la fuente de verdad), calculados con
 * consultas agrupadas (sin N+1). No decide autorización: recibe los `userIds` que el llamador YA autorizó.
 * Los intentos `PENDING` nunca cuentan como aciertos ni fallos.
 */
@Injectable()
export class AttemptAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async activityByUser(userIds: readonly string[], since?: Date): Promise<UserActivity[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.challengeAttempt.groupBy({
      by: ['userId'],
      where: { userId: { in: [...userIds] }, ...(since ? { startedAt: { gte: since } } : {}) },
      _count: { _all: true },
      _max: { startedAt: true },
    });
    return rows.map((row) => ({
      userId: row.userId,
      attemptsStarted: row._count._all,
      lastAttemptStartedAt: row._max.startedAt,
    }));
  }

  async completedChallenges(
    userIds: readonly string[],
    worldIds: readonly string[],
  ): Promise<CompletedChallengesRow[]> {
    if (userIds.length === 0 || worldIds.length === 0) return [];
    const rows = await this.prisma.challengeAttempt.groupBy({
      by: ['userId', 'worldId', 'challengeId'],
      where: { userId: { in: [...userIds] }, worldId: { in: [...worldIds] }, outcome: 'CORRECT' },
    });
    const counts = new Map<string, CompletedChallengesRow>();
    for (const { userId, worldId } of rows) {
      const key = `${userId}:${worldId}`;
      const entry = counts.get(key) ?? { userId, worldId, distinctChallenges: 0 };
      entry.distinctChallenges += 1;
      counts.set(key, entry);
    }
    return [...counts.values()];
  }

  /** Distribución de motivos de fallo (errores matemáticos de sintaxis/resultado, reglas incumplidas, tiempo…). */
  async failureReasons(userIds: readonly string[]): Promise<FailureReasonRow[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.challengeAttempt.groupBy({
      by: ['worldId', 'failureReason'],
      where: { userId: { in: [...userIds] }, failureReason: { not: null } },
      _count: { _all: true },
    });
    return rows.flatMap((row) =>
      row.failureReason ? [{ worldId: row.worldId, reason: row.failureReason, count: row._count._all }] : [],
    );
  }

  async challengeOutcomes(userIds: readonly string[]): Promise<ChallengeOutcomeRow[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.challengeAttempt.groupBy({
      by: ['worldId', 'challengeId', 'outcome'],
      where: { userId: { in: [...userIds] }, outcome: { not: 'PENDING' } },
      _count: { _all: true },
    });
    const byChallenge = new Map<string, ChallengeOutcomeRow>();
    for (const row of rows) {
      const entry = byChallenge.get(row.challengeId) ?? {
        worldId: row.worldId,
        challengeId: row.challengeId,
        attempts: 0,
        correct: 0,
      };
      entry.attempts += row._count._all;
      if (row.outcome === 'CORRECT') entry.correct += row._count._all;
      byChallenge.set(row.challengeId, entry);
    }
    return [...byChallenge.values()];
  }

  /**
   * Fallos consecutivos más recientes por (jugador, mundo), en una sola consulta con función de ventana.
   * Los ids UUIDv7 son cronológicos. Solo devuelve pares con al menos un fallo reciente.
   */
  async trailingFailures(userIds: readonly string[], cap = 20): Promise<TrailingFailuresRow[]> {
    if (userIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      { userId: string; worldId: string; failures: number }[]
    >(Prisma.sql`
      WITH recent AS (
        SELECT a."userId", a."worldId", a."outcome",
               ROW_NUMBER() OVER (PARTITION BY a."userId", a."worldId" ORDER BY a."id" DESC) AS rn
          FROM "challenge_attempts" a
         WHERE a."userId" IN (${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))})
           AND a."outcome" <> 'PENDING'
      )
      SELECT "userId", "worldId",
             LEAST(COALESCE(MIN(rn) FILTER (WHERE "outcome" = 'CORRECT') - 1, COUNT(*)), ${cap})::int AS failures
        FROM recent
       GROUP BY "userId", "worldId"
      HAVING LEAST(COALESCE(MIN(rn) FILTER (WHERE "outcome" = 'CORRECT') - 1, COUNT(*)), ${cap}) > 0`);
    return rows.map((row) => ({
      userId: row.userId,
      worldId: row.worldId,
      consecutiveFailures: Number(row.failures),
    }));
  }
}
