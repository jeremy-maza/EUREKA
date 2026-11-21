import { Injectable } from '@nestjs/common';
import { DbClient, PrismaService } from '../../prisma/prisma.service';
import { ScoreAward } from './scoring-engine';

export interface RecordScoreInput {
  userId: string;
  worldId: string;
  attemptId: string;
  award: ScoreAward;
}

/**
 * Libro mayor de puntos. Solo inserta: la BD rechaza UPDATE/DELETE (trigger) y `attemptId` es único,
 * de modo que un mismo intento jamás puede otorgar puntos dos veces.
 */
@Injectable()
export class ScoreService {
  constructor(private readonly prisma: PrismaService) {}

  /** Debe llamarse dentro de la transacción que resuelve el intento. */
  async recordCorrectAnswer(tx: DbClient, input: RecordScoreInput): Promise<void> {
    await tx.scoreTransaction.create({
      data: {
        userId: input.userId,
        worldId: input.worldId,
        attemptId: input.attemptId,
        reason: 'CORRECT_ANSWER',
        basePoints: input.award.basePoints,
        multiplierMilli: input.award.multiplierMilli,
        points: input.award.points,
        streakAfter: input.award.streakAfter,
      },
    });
  }

  /** Últimas transacciones del jugador en un mundo (más recientes primero). */
  listRecent(userId: string, worldId: string, limit: number) {
    return this.prisma.scoreTransaction.findMany({
      where: { userId, worldId },
      orderBy: { id: 'desc' },
      take: limit,
    });
  }
}
