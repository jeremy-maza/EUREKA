import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbClient, PrismaService } from '../../prisma/prisma.service';
import { LoadedWorld } from '../worlds';
import { ProgressionManager } from './progression-manager';
import { WorldProgressState } from './progression.types';

export interface StoredProgress {
  /** `null` si el jugador aún no ha jugado el mundo (no se crea fila en lecturas). */
  progressId: string | null;
  state: WorldProgressState;
  /** Reglas DOMINADAS (superadas alguna vez, colección permanente). No son las activas. */
  unlockedRules: { key: string; unlockedAt: Date }[];
  firstCompletedAt: Date | null;
  /** Secuencia ACTIVE del jugador en el mundo, si la hay. */
  activeSequence: { id: string; ruleKeys: readonly string[] } | null;
}

/** Resumen del progreso de un (jugador, mundo) para lecturas masivas (panel docente). */
export interface ProgressSummary {
  userId: string;
  worldId: string;
  currentPosition: number;
  streak: number;
  bestStreak: number;
  totalPoints: number;
  status: WorldProgressState['status'];
  /** Reglas dominadas (superadas alguna vez). */
  unlockedRulesCount: number;
  completionsCount: number;
}

/**
 * Persistencia del progreso por (jugador, mundo). Traduce entre filas de BD y el `WorldProgressState`
 * inmutable que usa el motor. Todas las escrituras reciben el cliente transaccional del llamador.
 */
@Injectable()
export class ProgressionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly manager: ProgressionManager,
  ) {}

  /** Lectura sin efectos: devuelve el estado inicial si el jugador nunca ha jugado el mundo. */
  async read(
    userId: string,
    world: LoadedWorld,
    db: DbClient | PrismaService = this.prisma,
  ): Promise<StoredProgress> {
    const row = await db.studentWorldProgress.findUnique({
      where: { userId_worldId: { userId, worldId: world.id } },
      include: {
        unlockedRules: {
          include: { rule: { select: { key: true } } },
          orderBy: [{ unlockedAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!row)
      return {
        progressId: null,
        state: this.manager.createInitialState(world.definition.slug),
        unlockedRules: [],
        firstCompletedAt: null,
        activeSequence: null,
      };

    const sequence = await db.gameSequence.findFirst({
      where: { userId, worldId: world.id, status: 'ACTIVE' },
      select: { id: true, ruleKeys: true },
    });
    // Reglas activas = las de la secuencia en curso ya superadas (posiciones 2 … actual − 1).
    const activeRuleIds = sequence ? sequence.ruleKeys.slice(0, Math.max(0, row.currentPosition - 2)) : [];
    return {
      progressId: row.id,
      unlockedRules: row.unlockedRules.map((u) => ({ key: u.rule.key, unlockedAt: u.unlockedAt })),
      firstCompletedAt: row.firstCompletedAt,
      activeSequence: sequence,
      state: {
        worldSlug: world.definition.slug,
        currentPosition: row.currentPosition,
        streak: row.currentStreak,
        bestStreak: row.bestStreak,
        totalPoints: row.totalPoints,
        unlockedRuleIds: activeRuleIds,
        status: row.status,
        completionsCount: row.completionsCount,
      },
    };
  }

  /**
   * Lectura masiva y sin efectos (una consulta) del progreso de varios jugadores. Misma fuente que `read`
   * (`StudentWorldProgress`), por lo que puntos y rachas coinciden con los que ve el propio jugador.
   * Solo devuelve filas existentes. El llamador es responsable de haber autorizado el acceso a `userIds`.
   */
  async listSummaries(userIds: readonly string[], worldIds: readonly string[]): Promise<ProgressSummary[]> {
    if (userIds.length === 0 || worldIds.length === 0) return [];
    const rows = await this.prisma.studentWorldProgress.findMany({
      where: { userId: { in: [...userIds] }, worldId: { in: [...worldIds] } },
      include: { _count: { select: { unlockedRules: true } } },
    });
    return rows.map((row) => ({
      userId: row.userId,
      worldId: row.worldId,
      currentPosition: row.currentPosition,
      streak: row.currentStreak,
      bestStreak: row.bestStreak,
      totalPoints: row.totalPoints,
      status: row.status,
      unlockedRulesCount: row._count.unlockedRules,
      completionsCount: row.completionsCount,
    }));
  }

  /**
   * Crea la fila si falta, la BLOQUEA (`FOR UPDATE`) hasta el fin de la transacción y devuelve el estado.
   * `ON CONFLICT DO NOTHING` + `SELECT … FOR UPDATE` es seguro ante primeros accesos concurrentes
   * (un `upsert` de Prisma podría fallar con P2002 y abortar la transacción).
   */
  async lockOrCreate(
    tx: DbClient,
    userId: string,
    world: LoadedWorld,
  ): Promise<StoredProgress & { progressId: string }> {
    await tx.$executeRaw`
      INSERT INTO student_world_progress (id, "userId", "worldId", "updatedAt")
      VALUES (${randomUUID()}::uuid, ${userId}::uuid, ${world.id}::uuid, now())
      ON CONFLICT ("userId", "worldId") DO NOTHING`;
    // Serializa todas las operaciones del mismo jugador y mundo (iniciar, responder, expirar).
    const [{ id }] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM student_world_progress
       WHERE "userId" = ${userId}::uuid AND "worldId" = ${world.id}::uuid
         FOR UPDATE`;
    const stored = await this.read(userId, world, tx);
    return { ...stored, progressId: id };
  }

  /**
   * Compleciones de varios mundos de un jugador (para decidir qué mundos están desbloqueados). Sin fila = 0.
   */
  async completionsByWorld(
    userId: string,
    worldIds: readonly string[],
    db: DbClient | PrismaService = this.prisma,
  ): Promise<Map<string, number>> {
    if (worldIds.length === 0) return new Map();
    const rows = await db.studentWorldProgress.findMany({
      where: { userId, worldId: { in: [...worldIds] } },
      select: { worldId: true, completionsCount: true },
    });
    return new Map(rows.map((row) => [row.worldId, row.completionsCount]));
  }

  /**
   * Persiste el nuevo estado y, si el acierto superó la regla que introducía el reto, la añade a las reglas
   * DOMINADAS (idempotente). La primera compleción del mundo fija `firstCompletedAt` (instante del servidor).
   */
  async save(
    tx: DbClient,
    progressId: string,
    world: LoadedWorld,
    state: WorldProgressState,
    newlyUnlockedRuleKey: string | null,
    now?: Date,
  ): Promise<void> {
    const current = await tx.studentWorldProgress.findUniqueOrThrow({
      where: { id: progressId },
      select: { firstCompletedAt: true },
    });
    await tx.studentWorldProgress.update({
      where: { id: progressId },
      data: {
        currentPosition: state.currentPosition,
        currentStreak: state.streak,
        bestStreak: state.bestStreak,
        totalPoints: state.totalPoints,
        status: state.status,
        completionsCount: state.completionsCount,
        ...(state.completionsCount > 0 && current.firstCompletedAt === null
          ? { firstCompletedAt: now ?? new Date() }
          : {}),
      },
    });
    if (newlyUnlockedRuleKey !== null) {
      const ruleId = world.ruleRowIds.get(newlyUnlockedRuleKey);
      if (!ruleId) throw new Error(`Regla desconocida al desbloquear: ${newlyUnlockedRuleKey}`);
      // La unicidad (progressId, ruleId) hace idempotente el desbloqueo.
      await tx.unlockedRule.upsert({
        where: { progressId_ruleId: { progressId, ruleId } },
        create: { progressId, ruleId },
        update: {},
      });
    }
  }
}
