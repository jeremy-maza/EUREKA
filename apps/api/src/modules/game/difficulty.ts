/**
 * Punto de extensión para la dificultad adaptativa (NO implementado todavía).
 * La dificultad deberá considerar la racha actual y el rendimiento histórico del jugador.
 * Un futuro generador de retos recibirá el nivel elegido por una `DifficultyPolicy`.
 */
export type DifficultyLevel = 'EASIER' | 'BASELINE' | 'HARDER';

export interface PlayerPerformanceSnapshot {
  attempts: number;
  /** Aciertos / intentos, en [0, 1]. */
  accuracy: number;
  averageCompletionMs: number | null;
  /** Reglas que el jugador incumple con más frecuencia. */
  frequentlyViolatedRuleIds: readonly string[];
  /** Conceptos matemáticos débiles detectados. */
  weakConcepts: readonly string[];
}

export interface DifficultyContext {
  currentStreak: number;
  /** `null` cuando aún no hay historial. */
  performance: PlayerPerformanceSnapshot | null;
}

export interface DifficultyPolicy {
  selectDifficulty(context: DifficultyContext): DifficultyLevel;
}

/** Política por defecto: dificultad constante. */
export const staticDifficultyPolicy: DifficultyPolicy = {
  selectDifficulty: () => 'BASELINE',
};
