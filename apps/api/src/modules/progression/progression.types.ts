import { ChallengeDefinition, RuleDefinition } from '../challenges';

export type WorldProgressStatus = 'IN_PROGRESS' | 'COMPLETED';

/**
 * Estado de un jugador en UN mundo (rachas y reglas son independientes por mundo).
 * Es un valor inmutable: cada operación devuelve un estado nuevo.
 * Se corresponde con `StudentWorldProgress` + `UnlockedRule` en la base de datos.
 */
export interface WorldProgressState {
  worldSlug: string;
  /** Posición (1-based) del reto actual. */
  currentPosition: number;
  streak: number;
  bestStreak: number;
  /** Puntos acumulados; nunca disminuyen. */
  totalPoints: number;
  /**
   * Ids de reglas desbloqueadas, en orden de desbloqueo. Una regla se desbloquea al COMPLETAR con éxito
   * el reto que la introduce; persisten entre fallos, reinicios de secuencia y sesiones.
   */
  unlockedRuleIds: readonly string[];
  status: WorldProgressStatus;
}

export interface PresentedChallenge {
  challenge: ChallengeDefinition;
  /** Reglas que aplican a este intento: las desbloqueadas + la que introduce el reto (si aún no lo está). */
  activeRules: readonly RuleDefinition[];
}
