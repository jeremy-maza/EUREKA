import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

// ───────────── Peticiones ─────────────

/** Única entrada del jugador: la expresión. Puntos, racha, plazos y resultado esperado los fija el servidor. */
export class SubmitAnswerDto {
  @ApiProperty({
    example: '41 + 1',
    maxLength: 200,
    description: 'Expresión (opcionalmente con "= resultado").',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  expression!: string;
}

export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ format: 'uuid', description: 'Cursor: `nextCursor` de la página anterior.' })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class RecentQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

// ───────────── Respuestas ─────────────

export class RuleDto {
  @ApiProperty({ example: 'arithmetic.forbidden-digit-2' }) key!: string;
  @ApiProperty({ example: 'FORBIDDEN_DIGIT' }) type!: string;
  @ApiProperty({ example: 'No puedes usar el dígito 2.' }) description!: string;
}

export class UnlockedRuleDto extends RuleDto {
  @ApiProperty() unlockedAt!: Date;
}

export class SessionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'arithmetic' }) worldSlug!: string;
  @ApiProperty() startedAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) endedAt!: Date | null;
}

export class StartSessionResponseDto {
  @ApiProperty({ type: SessionDto }) session!: SessionDto;
  @ApiProperty({ description: '`false` si se reanudó la sesión abierta existente.' }) created!: boolean;
}

export class ExpiredAttemptDto {
  @ApiProperty({ format: 'uuid' }) attemptId!: string;
  @ApiProperty({ example: 'TIMEOUT' }) outcome!: 'TIMEOUT';
}

/** Reto en curso. Nunca incluye resultado esperado ni solución. */
export class ChallengeAttemptDto {
  @ApiProperty({ format: 'uuid' }) attemptId!: string;
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty({ example: 'arithmetic' }) worldSlug!: string;
  @ApiProperty({ example: 2 }) position!: number;
  @ApiProperty({ example: 4 }) challengeCount!: number;
  @ApiProperty({ example: '3 * 7 * 2', description: 'Operación a resolver.' }) expression!: string;
  @ApiProperty({ type: [RuleDto], description: 'Todas las reglas activas (acumuladas + la nueva).' })
  rules!: RuleDto[];
  @ApiProperty({
    type: RuleDto,
    nullable: true,
    description: 'Regla que introduce este reto; se guarda al completarlo.',
  })
  newRule!: RuleDto | null;
  @ApiProperty({ example: 75 }) timeLimitSeconds!: number;
  @ApiProperty({ description: 'Inicio del reto (reloj del servidor).' }) startedAt!: Date;
  @ApiProperty({ description: 'Plazo (reloj del servidor).' }) deadlineAt!: Date;
  @ApiProperty({
    description: 'Hora actual del servidor, para calcular el tiempo restante sin fiarse del reloj local.',
  })
  serverTime!: Date;
  @ApiProperty({ example: 71000 }) remainingMs!: number;
  @ApiProperty({ description: '`true` si ya existía un intento abierto y se devuelve el mismo.' })
  resumed!: boolean;
  @ApiProperty({
    type: ExpiredAttemptDto,
    nullable: true,
    description: 'Intento anterior cerrado por tiempo al iniciar este.',
  })
  expiredAttempt!: ExpiredAttemptDto | null;
}

export class ViolationDto {
  @ApiProperty() ruleKey!: string;
  @ApiProperty() ruleType!: string;
  @ApiProperty() description!: string;
  @ApiProperty() message!: string;
}

export class ScoreAwardDto {
  @ApiProperty({ example: 100 }) basePoints!: number;
  @ApiProperty({ example: 1500, description: 'Multiplicador en milésimas (1500 = 1.5x).' })
  multiplierMilli!: number;
  @ApiProperty({ example: '1.5' }) multiplier!: string;
  @ApiProperty({ example: 150 }) points!: number;
}

export class WorldStatisticsDto {
  @ApiProperty() attemptsCount!: number;
  @ApiProperty() correctCount!: number;
  @ApiProperty() incorrectCount!: number;
  @ApiProperty() timeoutCount!: number;
  @ApiProperty({ nullable: true, type: Number }) averageCorrectElapsedMs!: number | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) ruleViolationCounts!: Record<
    string,
    number
  >;
}

export class WorldProgressDto {
  @ApiProperty({ example: 'arithmetic' }) worldSlug!: string;
  @ApiProperty({ enum: ['IN_PROGRESS', 'COMPLETED'] }) status!: 'IN_PROGRESS' | 'COMPLETED';
  @ApiProperty({ example: 2, description: 'Posición del reto actual (1-based).' }) currentPosition!: number;
  @ApiProperty({ example: 4 }) challengeCount!: number;
  @ApiProperty({ example: 3, description: 'Racha actual (independiente por mundo).' }) streak!: number;
  @ApiProperty() bestStreak!: number;
  @ApiProperty({ example: 450 }) totalPoints!: number;
  @ApiProperty({ example: 2000, description: 'Multiplicador (milésimas) que recibiría el próximo acierto.' })
  nextMultiplierMilli!: number;
  @ApiProperty({ example: '2' }) nextMultiplier!: string;
  @ApiProperty({ type: [UnlockedRuleDto] }) unlockedRules!: UnlockedRuleDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) activeSessionId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) pendingAttemptId!: string | null;
  @ApiProperty({ type: WorldStatisticsDto }) statistics!: WorldStatisticsDto;
}

export class AnswerResultDto {
  @ApiProperty({ format: 'uuid' }) attemptId!: string;
  @ApiProperty({ enum: ['CORRECT', 'INCORRECT', 'TIMEOUT'] }) outcome!: 'CORRECT' | 'INCORRECT' | 'TIMEOUT';
  @ApiProperty({
    enum: [
      'SYNTAX_ERROR',
      'DIVISION_BY_ZERO',
      'WRONG_RESULT',
      'CLAIMED_RESULT_MISMATCH',
      'RULE_VIOLATION',
      'TIMEOUT',
    ],
    nullable: true,
  })
  failureReason!: string | null;
  @ApiProperty() message!: string;
  @ApiProperty({
    example: '42',
    nullable: true,
    type: String,
    description: 'Valor de la expresión enviada, si se pudo evaluar.',
  })
  evaluatedValue!: string | null;
  @ApiProperty({ type: [ViolationDto] }) violations!: ViolationDto[];
  @ApiProperty({ type: ScoreAwardDto }) score!: ScoreAwardDto;
  @ApiProperty({ type: RuleDto, nullable: true, description: 'Regla que este acierto acaba de guardar.' })
  unlockedRule!: RuleDto | null;
  @ApiProperty({ description: 'El fallo/timeout devolvió al jugador al reto 1 (las reglas se conservan).' })
  sequenceRestarted!: boolean;
  @ApiProperty() worldCompleted!: boolean;
  @ApiProperty({ type: WorldProgressDto, description: 'Progreso del jugador tras este intento.' })
  progress!: WorldProgressDto;
  @ApiProperty({ description: '`true` si es la repetición idempotente de un envío ya resuelto.' })
  replayed!: boolean;
}

export class AttemptHistoryItemDto {
  @ApiProperty({ format: 'uuid' }) attemptId!: string;
  @ApiProperty() position!: number;
  @ApiProperty({ example: '3 * 7' }) expression!: string;
  @ApiProperty({ enum: ['PENDING', 'CORRECT', 'INCORRECT', 'TIMEOUT'] }) outcome!: string;
  @ApiProperty({ nullable: true, type: String }) failureReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) submission!: string | null;
  @ApiProperty({ nullable: true, type: String }) evaluatedValue!: string | null;
  @ApiProperty({ type: [String] }) activeRuleKeys!: string[];
  @ApiProperty() timeLimitSeconds!: number;
  @ApiProperty() startedAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) submittedAt!: Date | null;
  @ApiProperty({ nullable: true, type: Number }) elapsedMs!: number | null;
  @ApiProperty() streakBefore!: number;
  @ApiProperty() pointsAwarded!: number;
}

export class AttemptHistoryPageDto {
  @ApiProperty({ type: [AttemptHistoryItemDto] }) items!: AttemptHistoryItemDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Cursor para la página siguiente (null si no hay más).',
  })
  nextCursor!: string | null;
}

export class ScoreTransactionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) attemptId!: string | null;
  @ApiProperty({ enum: ['CORRECT_ANSWER', 'MANUAL_ADJUSTMENT'] }) reason!: string;
  @ApiProperty() basePoints!: number;
  @ApiProperty() multiplierMilli!: number;
  @ApiProperty() multiplier!: string;
  @ApiProperty() points!: number;
  @ApiProperty() streakAfter!: number;
  @ApiProperty() createdAt!: Date;
}

export class ScoreSummaryDto {
  @ApiProperty({ example: 'arithmetic' }) worldSlug!: string;
  @ApiProperty() totalPoints!: number;
  @ApiProperty() streak!: number;
  @ApiProperty() bestStreak!: number;
  @ApiProperty() nextMultiplierMilli!: number;
  @ApiProperty() nextMultiplier!: string;
  @ApiProperty({ type: [ScoreTransactionDto], description: 'Libro de puntos (más recientes primero).' })
  recentTransactions!: ScoreTransactionDto[];
}

// ───────────── Clasificación ─────────────

export class LeaderboardEntryDto {
  @ApiProperty({ example: 1, description: 'Posición (empates comparten posición).' }) rank!: number;
  @ApiProperty({ example: 'Ana' }) displayName!: string;
  @ApiProperty({ example: 450 }) points!: number;
  @ApiProperty({ description: '`true` en la fila del jugador autenticado.' }) isCurrentUser!: boolean;
}

export class LeaderboardDto {
  @ApiProperty({ example: 'arithmetic' }) worldSlug!: string;
  @ApiProperty({
    enum: ['GROUPS', 'SELF'],
    description:
      '`GROUPS`: compañeros con los que comparte un grupo activo. `SELF`: no pertenece a ningún grupo activo, solo aparece él.',
  })
  scope!: 'GROUPS' | 'SELF';
  @ApiProperty({ description: 'Personas incluidas en la clasificación (antes de aplicar `limit`).' })
  participants!: number;
  @ApiProperty({ type: [LeaderboardEntryDto], description: 'Las primeras posiciones, de mayor a menor.' })
  entries!: LeaderboardEntryDto[];
  @ApiProperty({
    type: LeaderboardEntryDto,
    description: 'La fila del jugador, aunque quede fuera de `entries`.',
  })
  me!: LeaderboardEntryDto;
}
