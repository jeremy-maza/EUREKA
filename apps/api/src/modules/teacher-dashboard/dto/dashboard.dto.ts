import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CursorPageQueryDto, PageInfoDto } from '../../../common';
import { AttemptFailureReason } from '../../../generated/prisma/client';
import { AttemptHistoryItemDto } from '../../game/dto/game.dto';
import { GroupDto, PersonDto, PersonWithEmailDto } from '../../groups';

// ───────────── Peticiones ─────────────

export class StatisticsQueryDto {
  @ApiPropertyOptional({
    default: 5,
    minimum: 1,
    maximum: 1000,
    description: 'Intentos mínimos para juzgar la precisión.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  minAttempts: number = 5;

  @ApiPropertyOptional({
    default: 50,
    minimum: 1,
    maximum: 100,
    description: 'Precisión (%) por debajo de la cual se marca atención.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  lowAccuracyBelow: number = 50;

  @ApiPropertyOptional({
    default: 3,
    minimum: 1,
    maximum: 20,
    description: 'Fallos consecutivos recientes para marcar atención.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  repeatedFailures: number = 3;

  @ApiPropertyOptional({
    default: 10,
    minimum: 1,
    maximum: 50,
    description: 'Máximo de elementos por ranking.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  top: number = 10;
}

export class StudentAttemptsQueryDto extends CursorPageQueryDto {
  @ApiPropertyOptional({ example: 'arithmetic', description: 'Filtra por mundo.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  worldSlug?: string;
}

// ───────────── Métricas ─────────────

/**
 * Convención: contadores sin actividad = 0 (cero real). Promedios y porcentajes sin denominador = `null`
 * (no disponible), nunca 0.
 */
export class MetricsDto {
  @ApiProperty({ description: 'Puntos acumulados (misma fuente que el progreso del propio estudiante).' })
  points!: number;
  @ApiProperty({ description: 'Intentos resueltos (acierto, fallo o timeout).' }) attempts!: number;
  @ApiProperty() correct!: number;
  @ApiProperty() incorrect!: number;
  @ApiProperty() timeouts!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'aciertos / intentos resueltos × 100; `null` sin intentos.',
  })
  accuracyPercent!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Tiempo medio (ms) de los ACIERTOS; `null` sin aciertos. No se agregan tiempos de fallos.',
  })
  averageCorrectResponseTimeMs!: number | null;
}

export class ActivitySummaryDto {
  @ApiProperty({ description: 'Estudiantes con membresía activa.' }) studentCount!: number;
  @ApiProperty({ description: 'Estudiantes que han iniciado al menos un intento alguna vez.' })
  studentsWithActivity!: number;
  @ApiProperty({ description: 'Estudiantes con algún intento iniciado en los últimos 7 días.' })
  activeStudentsLast7Days!: number;
  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'Último intento iniciado; `null` si nadie ha jugado.',
  })
  lastActivityAt!: Date | null;
  @ApiProperty({ type: MetricsDto }) totals!: MetricsDto;
}

// ───────────── Panel general y de grupo ─────────────

export class DashboardGroupDto {
  @ApiProperty({ type: GroupDto }) group!: GroupDto;
  @ApiProperty({ type: ActivitySummaryDto }) activity!: ActivitySummaryDto;
}

export class TeacherDashboardDto {
  @ApiProperty() generatedAt!: Date;
  @ApiProperty({ type: [DashboardGroupDto], description: 'Grupos ACTIVOS asignados al docente.' })
  groups!: DashboardGroupDto[];
}

export class WorldPerformanceDto extends MetricsDto {
  @ApiProperty({ example: 'arithmetic' }) worldSlug!: string;
  @ApiProperty() worldName!: string;
  @ApiProperty({ description: 'Estudiantes del grupo que han jugado este mundo.' }) studentsStarted!: number;
  @ApiProperty({ description: 'Estudiantes del grupo con el mundo completado actualmente.' })
  studentsCompleted!: number;
}

export class GroupDashboardDto {
  @ApiProperty() generatedAt!: Date;
  @ApiProperty({ type: GroupDto }) group!: GroupDto;
  @ApiProperty({ type: ActivitySummaryDto }) activity!: ActivitySummaryDto;
  @ApiProperty({ type: [WorldPerformanceDto] }) worlds!: WorldPerformanceDto[];
}

// ───────────── Estudiantes ─────────────

export class StudentWorldDto extends MetricsDto {
  @ApiProperty({ example: 'arithmetic' }) worldSlug!: string;
  @ApiProperty() worldName!: string;
  @ApiProperty({ enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] })
  progressStatus!: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Reto actual (1-based); `null` si no ha empezado.',
  })
  currentPosition!: number | null;
  @ApiProperty() challengeCount!: number;
  @ApiProperty({ description: 'Retos distintos acertados al menos una vez.' }) challengesCompleted!: number;
  @ApiProperty() unlockedRulesCount!: number;
  @ApiProperty() currentStreak!: number;
  @ApiProperty() maxStreak!: number;
}

export class StudentTotalsDto extends MetricsDto {
  @ApiProperty({ description: 'Suma de retos distintos acertados en todos los mundos.' })
  challengesCompleted!: number;
  @ApiProperty({ nullable: true, type: Date }) lastActivityAt!: Date | null;
}

export class StudentOverviewDto {
  @ApiProperty({ type: PersonWithEmailDto }) student!: PersonWithEmailDto;
  @ApiProperty() joinedAt!: Date;
  @ApiProperty({ type: StudentTotalsDto }) totals!: StudentTotalsDto;
  @ApiProperty({ type: [StudentWorldDto], description: 'Un elemento por mundo habilitado.' })
  worlds!: StudentWorldDto[];
}

export class StudentOverviewPageDto extends PageInfoDto {
  @ApiProperty({ type: [StudentOverviewDto] }) items!: StudentOverviewDto[];
}

// ───────────── Rendimiento de aprendizaje ─────────────

export class CommonErrorDto {
  @ApiProperty({ example: 'arithmetic' }) worldSlug!: string;
  @ApiProperty({ enum: AttemptFailureReason, enumName: 'AttemptFailureReason' })
  reason!: AttemptFailureReason;
  @ApiProperty() count!: number;
  @ApiProperty({ description: '% sobre todos los fallos del mundo en el alcance consultado.' })
  sharePercent!: number;
}

export class ViolatedRuleDto {
  @ApiProperty({ example: 'arithmetic' }) worldSlug!: string;
  @ApiProperty({ example: 'arithmetic.forbidden-digit-2' }) ruleKey!: string;
  @ApiProperty({ nullable: true, type: String, example: 'FORBIDDEN_DIGIT' }) ruleType!: string | null;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ description: 'Veces que se incumplió.' }) violations!: number;
  @ApiProperty({ description: 'Estudiantes distintos que la incumplieron.' }) studentsAffected!: number;
}

export class ChallengeDifficultyDto {
  @ApiProperty({ example: 'arithmetic' }) worldSlug!: string;
  @ApiProperty({ description: 'Posición del reto en la secuencia (1-based).' }) position!: number;
  @ApiProperty({ example: '3 * 7' }) expression!: string;
  @ApiProperty() attempts!: number;
  @ApiProperty() correct!: number;
  @ApiProperty() failures!: number;
  @ApiProperty({ nullable: true, type: Number }) failureRatePercent!: number | null;
}

export class StudentAttentionDto {
  @ApiProperty({ type: PersonDto }) student!: PersonDto;
  @ApiProperty({ enum: ['LOW_ACCURACY', 'REPEATED_FAILURES'], isArray: true })
  reasons!: ('LOW_ACCURACY' | 'REPEATED_FAILURES')[];
  @ApiProperty() attempts!: number;
  @ApiProperty({ nullable: true, type: Number }) accuracyPercent!: number | null;
  @ApiProperty({
    description: 'Mayor racha actual de fallos/timeouts consecutivos en cualquier mundo (tope 20).',
  })
  consecutiveFailures!: number;
}

export class ThresholdsDto {
  @ApiProperty() minAttempts!: number;
  @ApiProperty() lowAccuracyBelow!: number;
  @ApiProperty() repeatedFailures!: number;
  @ApiProperty() top!: number;
}

export class GroupStatisticsDto {
  @ApiProperty() generatedAt!: Date;
  @ApiProperty() studentCount!: number;
  @ApiProperty({ type: ThresholdsDto }) thresholds!: ThresholdsDto;
  @ApiProperty({ type: [WorldPerformanceDto] }) performanceByWorld!: WorldPerformanceDto[];
  @ApiProperty({
    type: [CommonErrorDto],
    description: 'Motivos de fallo (sintaxis, resultado, reglas, tiempo…).',
  })
  commonErrors!: CommonErrorDto[];
  @ApiProperty({ type: [ViolatedRuleDto] }) frequentlyViolatedRules!: ViolatedRuleDto[];
  @ApiProperty({
    type: [ChallengeDifficultyDto],
    description:
      'Retos con precisión por debajo del umbral (conceptos a reforzar). Reglas: ver `frequentlyViolatedRules`.',
  })
  challengesNeedingReinforcement!: ChallengeDifficultyDto[];
  @ApiProperty({ type: [StudentAttentionDto] }) studentsNeedingAttention!: StudentAttentionDto[];
}

export class StudentWorldStatisticsDto extends StudentWorldDto {
  @ApiProperty({ description: 'Fallos/timeouts consecutivos más recientes (tope 20).' })
  consecutiveFailures!: number;
  @ApiProperty({ type: [CommonErrorDto] }) commonErrors!: CommonErrorDto[];
  @ApiProperty({ type: [ViolatedRuleDto] }) violatedRules!: ViolatedRuleDto[];
  @ApiProperty({
    type: [ChallengeDifficultyDto],
    description: 'Todos los retos del mundo (con 0 intentos si no se jugaron).',
  })
  challenges!: ChallengeDifficultyDto[];
}

export class StudentStatisticsDto {
  @ApiProperty() generatedAt!: Date;
  @ApiProperty({ type: PersonWithEmailDto }) student!: PersonWithEmailDto;
  @ApiProperty({ type: [StudentWorldStatisticsDto] }) worlds!: StudentWorldStatisticsDto[];
}

export class StudentAttemptDto extends AttemptHistoryItemDto {
  @ApiProperty({ example: 'arithmetic' }) worldSlug!: string;
}

export class StudentAttemptPageDto extends PageInfoDto {
  @ApiProperty({ type: [StudentAttemptDto], description: 'Intentos resueltos, más recientes primero.' })
  items!: StudentAttemptDto[];
}
