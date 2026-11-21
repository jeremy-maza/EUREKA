import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgressionService } from '../progression';
import { ScoreService, StreakManager, formatMultiplier } from '../scoring';
import { WorldsRepository } from '../worlds';
import { AttemptHistoryPageDto, ScoreSummaryDto, UnlockedRuleDto, WorldProgressDto } from './dto/game.dto';
import { GameService } from './game.service';
import { toHistoryItem, toScoreTransactionDto } from './game.mappers';
import { ProgressViewBuilder } from './progress-view.builder';

/**
 * Consultas del estado del jugador (progreso, reglas, puntos, historial). Antes de leer cierra por
 * tiempo cualquier intento vencido, de modo que las lecturas siempre reflejan las reglas del juego.
 * Todas son de solo lectura sobre datos del propio usuario autenticado.
 */
@Injectable()
export class PlayerStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly worlds: WorldsRepository,
    private readonly game: GameService,
    private readonly progression: ProgressionService,
    private readonly progressView: ProgressViewBuilder,
    private readonly scores: ScoreService,
    private readonly streaks: StreakManager,
  ) {}

  /** Progreso (y rachas, independientes) en todos los mundos disponibles. */
  async listProgress(userId: string): Promise<WorldProgressDto[]> {
    const worlds = await this.worlds.listEnabled();
    return Promise.all(
      worlds.map(async (world) => {
        await this.game.settleOverdue(userId, world);
        return this.progressView.build(this.prisma, userId, world);
      }),
    );
  }

  async getProgress(userId: string, worldSlug: string): Promise<WorldProgressDto> {
    const world = await this.worlds.getBySlug(worldSlug);
    await this.game.settleOverdue(userId, world);
    return this.progressView.build(this.prisma, userId, world);
  }

  /** Reglas acumuladas del jugador en el mundo (las del reto en curso aún no cuentan hasta completarlo). */
  async getUnlockedRules(userId: string, worldSlug: string): Promise<UnlockedRuleDto[]> {
    return (await this.getProgress(userId, worldSlug)).unlockedRules;
  }

  async getScore(userId: string, worldSlug: string, limit: number): Promise<ScoreSummaryDto> {
    const world = await this.worlds.getBySlug(worldSlug);
    await this.game.settleOverdue(userId, world);
    const { state } = await this.progression.read(userId, world);
    const next = this.streaks.multiplierMilliFor(state.streak + 1);
    const transactions = await this.scores.listRecent(userId, world.id, limit);
    return {
      worldSlug,
      totalPoints: state.totalPoints,
      streak: state.streak,
      bestStreak: state.bestStreak,
      nextMultiplierMilli: next,
      nextMultiplier: formatMultiplier(next),
      recentTransactions: transactions.map(toScoreTransactionDto),
    };
  }

  /** Historial paginado por cursor (ids UUIDv7 ⇒ orden cronológico), más recientes primero. */
  async getAttemptHistory(
    userId: string,
    worldSlug: string,
    limit: number,
    cursor?: string,
  ): Promise<AttemptHistoryPageDto> {
    const world = await this.worlds.getBySlug(worldSlug);
    await this.game.settleOverdue(userId, world);

    const rows = await this.prisma.challengeAttempt.findMany({
      where: { userId, worldId: world.id, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { challenge: { select: { key: true } } },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => toHistoryItem(row, world.definition)),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }
}
