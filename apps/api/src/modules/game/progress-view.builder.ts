import { Injectable } from '@nestjs/common';
import { DbClient, PrismaService } from '../../prisma/prisma.service';
import { ProgressionService } from '../progression';
import { StreakManager, formatMultiplier } from '../scoring';
import { StatisticsService } from '../statistics';
import { LoadedWorld } from '../worlds';
import { WorldProgressDto } from './dto/game.dto';

/** Construye la vista pública del progreso. Recibe el cliente de BD para leer dentro de la misma transacción. */
@Injectable()
export class ProgressViewBuilder {
  constructor(
    private readonly progression: ProgressionService,
    private readonly statistics: StatisticsService,
    private readonly streaks: StreakManager,
  ) {}

  async build(db: DbClient | PrismaService, userId: string, world: LoadedWorld): Promise<WorldProgressDto> {
    const stored = await this.progression.read(userId, world, db);
    const rulesByKey = new Map(world.definition.rules.map((rule) => [rule.id, rule]));
    const nextMultiplierMilli = this.streaks.multiplierMilliFor(stored.state.streak + 1);

    const [stats, openSession, pending] = await Promise.all([
      this.statistics.get(userId, world.id, db),
      db.gameSession.findFirst({ where: { userId, worldId: world.id, endedAt: null }, select: { id: true } }),
      db.challengeAttempt.findFirst({
        where: { userId, worldId: world.id, outcome: 'PENDING' },
        select: { id: true },
      }),
    ]);

    return {
      worldSlug: world.definition.slug,
      status: stored.state.status,
      currentPosition: stored.state.currentPosition,
      challengeCount: world.definition.challenges.length,
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
