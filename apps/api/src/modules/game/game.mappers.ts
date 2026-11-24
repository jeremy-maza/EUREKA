import { ChallengeAttempt, GameSession, Prisma, ScoreTransaction } from '../../generated/prisma/client';
import { RuleDefinition } from '../challenges';
import { formatMultiplier } from '../scoring';
import {
  AttemptHistoryItemDto,
  RuleDto,
  ScoreTransactionDto,
  SessionDto,
  ViolationDto,
} from './dto/game.dto';

export const toRuleDto = (rule: RuleDefinition): RuleDto => ({
  key: rule.id,
  type: rule.type,
  description: rule.description,
});

export const toSessionDto = (session: GameSession, worldSlug: string): SessionDto => ({
  id: session.id,
  worldSlug,
  startedAt: session.startedAt,
  endedAt: session.endedAt,
});

export function parseViolations(json: Prisma.JsonValue | null): ViolationDto[] {
  return Array.isArray(json) ? (json as unknown as ViolationDto[]) : [];
}

export function toScoreTransactionDto(row: ScoreTransaction): ScoreTransactionDto {
  return {
    id: row.id,
    attemptId: row.attemptId,
    reason: row.reason,
    basePoints: row.basePoints,
    multiplierMilli: row.multiplierMilli,
    multiplier: formatMultiplier(row.multiplierMilli),
    points: row.points,
    streakAfter: row.streakAfter,
    createdAt: row.createdAt,
  };
}

/** El intento guarda una instantánea del reto presentado (posición y enunciado), también los del catálogo antiguo. */
export function toHistoryItem(attempt: ChallengeAttempt): AttemptHistoryItemDto {
  return {
    attemptId: attempt.id,
    position: attempt.position,
    expression: attempt.expression,
    outcome: attempt.outcome,
    failureReason: attempt.failureReason,
    submission: attempt.submission,
    evaluatedValue: attempt.evaluatedValue,
    activeRuleKeys: attempt.activeRuleKeys,
    timeLimitSeconds: attempt.timeLimitSeconds,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    elapsedMs: attempt.elapsedMs,
    streakBefore: attempt.streakBefore,
    pointsAwarded: attempt.pointsAwarded,
  };
}
