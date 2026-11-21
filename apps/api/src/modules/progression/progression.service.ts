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
  unlockedRules: { key: string; unlockedAt: Date }[];
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
      };

    const unlockedRules = row.unlockedRules.map((u) => ({ key: u.rule.key, unlockedAt: u.unlockedAt }));
    return {
      progressId: row.id,
      unlockedRules,
      state: {
        worldSlug: world.definition.slug,
        currentPosition: row.currentPosition,
        streak: row.currentStreak,
        bestStreak: row.bestStreak,
        totalPoints: row.totalPoints,
        unlockedRuleIds: unlockedRules.map((u) => u.key),
        status: row.status,
      },
    };
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

  /** Persiste el nuevo estado y la regla recién desbloqueada, si la hay. */
  async save(
    tx: DbClient,
    progressId: string,
    world: LoadedWorld,
    state: WorldProgressState,
    newlyUnlockedRuleKey: string | null,
  ): Promise<void> {
    await tx.studentWorldProgress.update({
      where: { id: progressId },
      data: {
        currentPosition: state.currentPosition,
        currentStreak: state.streak,
        bestStreak: state.bestStreak,
        totalPoints: state.totalPoints,
        status: state.status,
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
