import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock, SeedSource } from '../../common';
import { GameSequence, SequenceChallenge } from '../../generated/prisma/client';
import { DbClient } from '../../prisma/prisma.service';
import { ChallengeDefinition, StatementKind } from '../challenges';
import { PlayableSequence, WorldProgressState } from '../progression';
import { SequencePlan, planSequence } from '../sequences';
import { LoadedWorld } from '../worlds';
import { DIFFICULTY_WINDOW, summarizePerformance } from './difficulty';
import type { DifficultyLevel, DifficultyPolicy } from './difficulty';

/** Token de inyección de la política de dificultad (sustituible en pruebas). */
export const DIFFICULTY_POLICY = Symbol('DIFFICULTY_POLICY');

/** Firma del planificador (inyectable para poder simular fallos del catálogo en pruebas). */
export type SequencePlanner = typeof planSequence;
export const SEQUENCE_PLANNER = Symbol('SEQUENCE_PLANNER');

export type SequenceRow = GameSequence & { challenges: SequenceChallenge[] };

/** Secuencia guardada + su vista jugable para el motor. */
export interface StoredSequence {
  row: SequenceRow;
  playable: PlayableSequence;
}

/**
 * Persistencia de secuencias. Una secuencia se planifica UNA vez (subconjunto y orden de reglas, retos generados)
 * y se guarda entera; los intentos la referencian. Todas las operaciones reciben el cliente transaccional del
 * llamador, que ya tiene bloqueado el progreso del jugador en el mundo (no hay carreras al crearla).
 */
@Injectable()
export class SequenceStore {
  private readonly logger = new Logger(SequenceStore.name);

  constructor(
    private readonly clock: Clock,
    private readonly seeds: SeedSource,
    @Inject(DIFFICULTY_POLICY) private readonly policy: DifficultyPolicy,
    @Inject(SEQUENCE_PLANNER) private readonly planner: SequencePlanner,
  ) {}

  async findActive(tx: DbClient, userId: string, world: LoadedWorld): Promise<StoredSequence | null> {
    const row = await tx.gameSequence.findFirst({
      where: { userId, worldId: world.id, status: 'ACTIVE' },
      include: { challenges: { orderBy: { position: 'asc' } } },
    });
    return row ? { row, playable: this.toPlayable(world, row) } : null;
  }

  async findById(tx: DbClient, sequenceId: string, world: LoadedWorld): Promise<StoredSequence> {
    const row = await tx.gameSequence.findUniqueOrThrow({
      where: { id: sequenceId },
      include: { challenges: { orderBy: { position: 'asc' } } },
    });
    return { row, playable: this.toPlayable(world, row) };
  }

  /**
   * Planifica y guarda una secuencia nueva: la dificultad sale del rendimiento reciente del jugador en el mundo y la
   * semilla, del servidor. Requiere el bloqueo de progreso y que no haya otra ACTIVE (índice único parcial).
   */
  async open(
    tx: DbClient,
    userId: string,
    world: LoadedWorld,
    state: WorldProgressState,
  ): Promise<StoredSequence> {
    const difficulty = await this.chooseDifficulty(tx, userId, world, state);
    const seed = this.seeds.next();
    const plan = this.planner(world.definition, { seed, difficulty });
    this.assertPlanMatchesWorld(world, plan);

    const row = await tx.gameSequence.create({
      data: {
        userId,
        worldId: world.id,
        seed: plan.seed,
        difficulty: plan.difficulty,
        ruleKeys: [...plan.ruleIds],
        generatorVersion: plan.generatorVersion,
        startedAt: this.clock.now(),
        challenges: {
          create: plan.challenges.map((challenge) => ({
            position: challenge.position,
            statementKind: challenge.statementKind ?? 'EXPRESSION',
            expression: challenge.expression,
            expectedResult: challenge.expectedResult,
            referenceSolution: challenge.referenceSolution,
            introducesRuleKey: challenge.introducesRuleId,
            fingerprint: challenge.generation.fingerprint,
            templateId: challenge.generation.templateId,
            seed: challenge.generation.seed,
          })),
        },
      },
      include: { challenges: { orderBy: { position: 'asc' } } },
    });
    this.logger.debug(
      `Secuencia ${row.id} (${world.definition.slug}, ${difficulty}, semilla ${seed}): ${plan.ruleIds.join(', ')}`,
    );
    return { row, playable: this.toPlayable(world, row) };
  }

  /** Cierra la secuencia (fallo o compleción). Idempotente sobre secuencias ya cerradas. */
  async close(tx: DbClient, sequenceId: string, status: 'COMPLETED' | 'FAILED'): Promise<void> {
    await tx.gameSequence.updateMany({
      where: { id: sequenceId, status: 'ACTIVE' },
      data: { status, endedAt: this.clock.now() },
    });
  }

  toPlayable(world: LoadedWorld, row: SequenceRow): PlayableSequence {
    const challenges: ChallengeDefinition[] = row.challenges.map((challenge) => ({
      id: challenge.id,
      position: challenge.position,
      expression: challenge.expression,
      expectedResult: challenge.expectedResult,
      introducesRuleId: challenge.introducesRuleKey,
      referenceSolution: challenge.referenceSolution,
      statementKind: challenge.statementKind as StatementKind,
    }));
    return { worldSlug: world.definition.slug, rules: world.definition.rules, challenges };
  }

  private async chooseDifficulty(
    tx: DbClient,
    userId: string,
    world: LoadedWorld,
    state: WorldProgressState,
  ): Promise<DifficultyLevel> {
    const recent = await tx.challengeAttempt.findMany({
      where: { userId, worldId: world.id, outcome: { not: 'PENDING' } },
      orderBy: { id: 'desc' },
      take: DIFFICULTY_WINDOW,
      select: { outcome: true },
    });
    return this.policy.selectDifficulty({
      currentStreak: state.streak,
      completionsCount: state.completionsCount,
      performance: summarizePerformance(
        recent.map((attempt) => attempt.outcome as 'CORRECT' | 'INCORRECT' | 'TIMEOUT'),
      ),
    });
  }

  /** Defensa en profundidad: el plan solo puede usar reglas del mundo con fila en la BD. */
  private assertPlanMatchesWorld(world: LoadedWorld, plan: SequencePlan): void {
    const unknown = plan.ruleIds.filter((id) => !world.ruleRowIds.has(id));
    if (unknown.length > 0 || plan.challenges.length !== plan.ruleIds.length + 1) {
      throw new Error(
        `Plan de secuencia incoherente para "${world.definition.slug}" (reglas desconocidas: ${unknown.join(', ') || '—'}).`,
      );
    }
  }
}
