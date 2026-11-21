import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { DbClient, PrismaService } from '../../prisma/prisma.service';

export interface RecordAttemptStats {
  userId: string;
  worldId: string;
  outcome: 'CORRECT' | 'INCORRECT' | 'TIMEOUT';
  elapsedMs: number | null;
  violatedRuleKeys: readonly string[];
}

export interface WorldStatisticsSnapshot {
  attemptsCount: number;
  correctCount: number;
  incorrectCount: number;
  timeoutCount: number;
  /** Tiempo medio de los aciertos (ms), o null si aún no hay aciertos. */
  averageCorrectElapsedMs: number | null;
  ruleViolationCounts: Record<string, number>;
}

/** Fila de `WorldStatistics` ya traducida, con el total de tiempos (necesario para promediar entre estudiantes). */
export interface WorldStatisticsRow {
  userId: string;
  worldId: string;
  snapshot: WorldStatisticsSnapshot;
  /** Suma de `elapsedMs` de los aciertos: permite agregar promedios sin pérdida (total / aciertos). */
  totalCorrectElapsedMs: number;
}

function toSnapshot(row: {
  attemptsCount: number;
  correctCount: number;
  incorrectCount: number;
  timeoutCount: number;
  totalCorrectElapsedMs: number;
  ruleViolationCounts: Prisma.JsonValue;
}): WorldStatisticsSnapshot {
  return {
    attemptsCount: row.attemptsCount,
    correctCount: row.correctCount,
    incorrectCount: row.incorrectCount,
    timeoutCount: row.timeoutCount,
    averageCorrectElapsedMs:
      row.correctCount > 0 ? Math.round(row.totalCorrectElapsedMs / row.correctCount) : null,
    ruleViolationCounts: row.ruleViolationCounts as Record<string, number>,
  };
}

const EMPTY: WorldStatisticsSnapshot = {
  attemptsCount: 0,
  correctCount: 0,
  incorrectCount: 0,
  timeoutCount: 0,
  averageCorrectElapsedMs: null,
  ruleViolationCounts: {},
};

/** Agregados por (jugador, mundo), actualizados dentro de la transacción que resuelve cada intento. */
@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async recordAttempt(tx: DbClient, input: RecordAttemptStats): Promise<void> {
    const where = { userId_worldId: { userId: input.userId, worldId: input.worldId } };
    const current = await tx.worldStatistics.findUnique({ where });
    const violations = { ...((current?.ruleViolationCounts as Record<string, number> | null) ?? {}) };
    for (const key of input.violatedRuleKeys) violations[key] = (violations[key] ?? 0) + 1;

    const data = {
      attemptsCount: (current?.attemptsCount ?? 0) + 1,
      correctCount: (current?.correctCount ?? 0) + (input.outcome === 'CORRECT' ? 1 : 0),
      incorrectCount: (current?.incorrectCount ?? 0) + (input.outcome === 'INCORRECT' ? 1 : 0),
      timeoutCount: (current?.timeoutCount ?? 0) + (input.outcome === 'TIMEOUT' ? 1 : 0),
      totalCorrectElapsedMs:
        (current?.totalCorrectElapsedMs ?? 0) + (input.outcome === 'CORRECT' ? (input.elapsedMs ?? 0) : 0),
      ruleViolationCounts: violations as Prisma.InputJsonValue,
    };
    await tx.worldStatistics.upsert({
      where,
      create: { userId: input.userId, worldId: input.worldId, ...data },
      update: data,
    });
  }

  async get(
    userId: string,
    worldId: string,
    db: DbClient | PrismaService = this.prisma,
  ): Promise<WorldStatisticsSnapshot> {
    const row = await db.worldStatistics.findUnique({ where: { userId_worldId: { userId, worldId } } });
    if (!row) return { ...EMPTY };
    return toSnapshot(row);
  }

  /**
   * Lectura masiva (una sola consulta) para varios jugadores y mundos; usada por el panel docente.
   * Solo devuelve filas existentes: la ausencia de fila significa que el jugador nunca ha jugado ese mundo.
   * El llamador es responsable de haber autorizado el acceso a `userIds`.
   */
  async getMany(userIds: readonly string[], worldIds: readonly string[]): Promise<WorldStatisticsRow[]> {
    if (userIds.length === 0 || worldIds.length === 0) return [];
    const rows = await this.prisma.worldStatistics.findMany({
      where: { userId: { in: [...userIds] }, worldId: { in: [...worldIds] } },
    });
    return rows.map((row) => ({
      userId: row.userId,
      worldId: row.worldId,
      snapshot: toSnapshot(row),
      totalCorrectElapsedMs: row.totalCorrectElapsedMs,
    }));
  }
}
