import { ChallengeAttempt, GameSession, Prisma, ScoreTransaction } from '../../generated/prisma/client';
import { RuleDefinition } from '../challenges';
import { formatMultiplier } from '../scoring';
import { WorldDefinition } from '../worlds';
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

export function toHistoryItem(
  attempt: ChallengeAttempt & { challenge: { key: string } },
  world: WorldDefinition,
): AttemptHistoryItemDto {
  const challenge = world.challenges.find((c) => c.id === attempt.challenge.key);
  return {
    attemptId: attempt.id,
    position: challenge?.position ?? 0,
    expression: challenge?.expression ?? '',
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
