import {
  ChallengeDefinition,
  EvaluationFailureReason,
  RuleDefinition,
  SubmissionEvaluation,
} from '../challenges';
import { WorldProgressState } from '../progression';
import { ScoreAward } from '../scoring';

/** Un reto en curso. Todos los instantes los fija el servidor. */
export interface ActiveChallenge {
  challenge: ChallengeDefinition;
  /** Reglas que aplican a este intento (acumuladas + la del reto). */
  activeRules: readonly RuleDefinition[];
  startedAt: Date;
  deadlineAt: Date;
  timeLimitSeconds: number;
  /** Racha al iniciar el reto (para auditoría). */
  streakBefore: number;
}

export interface StartedChallenge {
  state: WorldProgressState;
  activeChallenge: ActiveChallenge;
}

export type AttemptOutcome = 'CORRECT' | 'INCORRECT' | 'TIMEOUT';
export type AttemptFailureReason = EvaluationFailureReason | 'TIMEOUT';

export interface AttemptResult {
  outcome: AttemptOutcome;
  failureReason: AttemptFailureReason | null;
  message: string;
  /** `null` cuando hubo timeout (la respuesta tardía no se evalúa). */
  evaluation: SubmissionEvaluation | null;
  award: ScoreAward;
  elapsedMs: number;
  /** Nuevo estado de progreso (el original no se modifica). */
  state: WorldProgressState;
  /** `true` si el intento fallido devolvió al jugador al reto 1. */
  sequenceRestarted: boolean;
  /** `true` si se acaba de completar el último reto del mundo. */
  worldCompleted: boolean;
}
