import { ChallengeDefinition } from '../challenges';

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
  /** Ids de reglas desbloqueadas, en orden de desbloqueo. Persisten entre fallos y sesiones. */
  unlockedRuleIds: readonly string[];
  status: WorldProgressStatus;
}

export interface BegunChallenge {
  state: WorldProgressState;
  challenge: ChallengeDefinition;
}
