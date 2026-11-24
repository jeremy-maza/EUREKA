import { ChallengeDefinition, RuleDefinition } from '../challenges';

export type WorldProgressStatus = 'IN_PROGRESS' | 'COMPLETED';

/**
 * Estado de un jugador en UN mundo (rachas y reglas son independientes por mundo).
 * Es un valor inmutable: cada operación devuelve un estado nuevo.
 * Se corresponde con `StudentWorldProgress` + la `GameSequence` activa en la base de datos.
 */
export interface WorldProgressState {
  worldSlug: string;
  /** Posición (1-based) del reto actual dentro de la secuencia. */
  currentPosition: number;
  streak: number;
  bestStreak: number;
  /** Puntos acumulados; nunca disminuyen. */
  totalPoints: number;
  /**
   * Reglas ACTIVAS de la secuencia en curso ya superadas, en orden de introducción. Una regla entra al COMPLETAR
   * con éxito el reto que la introduce; un fallo descarta todas (la próxima secuencia sortea otras).
   */
  unlockedRuleIds: readonly string[];
  status: WorldProgressStatus;
  /** Secuencias completas superadas en este mundo (desbloquean el siguiente si > 0). */
  completionsCount: number;
}

/**
 * Secuencia jugable: reglas del mundo y retos generados para ESTA secuencia (`challenges[i].position === i + 1`).
 * Es la vista que necesita el motor; la persistencia la reconstruye desde `GameSequence`/`SequenceChallenge`.
 */
export interface PlayableSequence {
  worldSlug: string;
  /** Repertorio de reglas del mundo (para resolver ids). */
  rules: readonly RuleDefinition[];
  challenges: readonly ChallengeDefinition[];
}

export interface PresentedChallenge {
  challenge: ChallengeDefinition;
  /** Reglas que aplican a este intento: las ya superadas en la secuencia + la que introduce el reto. */
  activeRules: readonly RuleDefinition[];
}
