import { Injectable } from '@nestjs/common';
import { DbClient, PrismaService } from '../../prisma/prisma.service';
import { ProgressionService } from '../progression';
import { StreakManager, formatMultiplier } from '../scoring';
import { StatisticsService } from '../statistics';
import { LoadedWorld } from '../worlds';
import { DifficultyDto, WorldProgressDto } from './dto/game.dto';
import { toRuleDto } from './game.mappers';
import { WorldUnlockService } from './world-unlocks.service';

/** Construye la vista pública del progreso. Recibe el cliente de BD para leer dentro de la misma transacción. */
@Injectable()
export class ProgressViewBuilder {
  constructor(
    private readonly progression: ProgressionService,
    private readonly statistics: StatisticsService,
    private readonly streaks: StreakManager,
    private readonly unlocks: WorldUnlockService,
  ) {}

  async build(db: DbClient | PrismaService, userId: string, world: LoadedWorld): Promise<WorldProgressDto> {
    const stored = await this.progression.read(userId, world, db);
    const { definition } = world;
    const rulesByKey = new Map(definition.rules.map((rule) => [rule.id, rule]));
    const nextMultiplierMilli = this.streaks.multiplierMilliFor(stored.state.streak + 1);

    const [stats, openSession, pending, sequence, unlockStatus] = await Promise.all([
      this.statistics.get(userId, world.id, db),
      db.gameSession.findFirst({ where: { userId, worldId: world.id, endedAt: null }, select: { id: true } }),
      db.challengeAttempt.findFirst({
        where: { userId, worldId: world.id, outcome: 'PENDING' },
        select: { id: true },
      }),
      stored.activeSequence
        ? db.gameSequence.findUnique({
            where: { id: stored.activeSequence.id },
            select: { id: true, difficulty: true, ruleKeys: true },
          })
        : Promise.resolve(null),
      this.unlocks.statusFor(userId, db),
    ]);
    const unlock = unlockStatus.get(world.id) ?? { unlocked: true, requirement: null };

    return {
      worldSlug: definition.slug,
      status: stored.state.status,
      currentPosition: stored.state.currentPosition,
      challengeCount: sequence ? sequence.ruleKeys.length + 1 : definition.sequence.ruleCount.BASELINE + 1,
      unlocked: unlock.unlocked,
      unlockRequirement: unlock.requirement
        ? {
            worldSlug: unlock.requirement.definition.slug,
            worldName: unlock.requirement.definition.name,
            position: unlock.requirement.definition.position,
          }
        : null,
      completionsCount: stored.state.completionsCount,
      firstCompletedAt: stored.firstCompletedAt,
      ruleCount: definition.rules.length,
      activeSequence: sequence
        ? {
            id: sequence.id,
            difficulty: sequence.difficulty as DifficultyDto,
            challengeCount: sequence.ruleKeys.length + 1,
            rules: stored.state.unlockedRuleIds.flatMap((key) => {
              const rule = rulesByKey.get(key);
              return rule ? [toRuleDto(rule)] : [];
            }),
          }
        : null,
      streak: stored.state.streak,
      bestStreak: stored.state.bestStreak,
      totalPoints: stored.state.totalPoints,
      nextMultiplierMilli,
      nextMultiplier: formatMultiplier(nextMultiplierMilli),
      unlockedRules: stored.unlockedRules.flatMap(({ key, unlockedAt }) => {
        const rule = rulesByKey.get(key);
        return rule ? [{ key, type: rule.type, description: rule.description, unlockedAt }] : [];
      }),
      activeSessionId: openSession?.id ?? null,
      pendingAttemptId: pending?.id ?? null,
      statistics: stats,
    };
  }
}
