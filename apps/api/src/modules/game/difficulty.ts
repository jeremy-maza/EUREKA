import { DifficultyLevel } from '../worlds/world.types';

export type { DifficultyLevel } from '../worlds/world.types';

/**
 * Rendimiento reciente del jugador EN UN MUNDO, medido por el servidor. Lo construye `GameService` a partir del
 * historial de intentos resueltos (más recientes primero).
 */
export interface PlayerPerformanceSnapshot {
  /** Intentos resueltos considerados (los N más recientes). */
  attempts: number;
  /** Aciertos / intentos, en [0, 1]. */
  accuracy: number;
  /** Timeouts / intentos, en [0, 1]. */
  timeoutRate: number;
  /** Fallos consecutivos más recientes (0 si el último intento fue un acierto). */
  consecutiveFailures: number;
}

export interface DifficultyContext {
  currentStreak: number;
  /** Secuencias completas superadas en el mundo. */
  completionsCount: number;
  /** `null` cuando aún no hay historial. */
  performance: PlayerPerformanceSnapshot | null;
}

export interface DifficultyPolicy {
  selectDifficulty(context: DifficultyContext): DifficultyLevel;
}

/** Intentos recientes que mira la política. */
export const DIFFICULTY_WINDOW = 12;
/** Con menos intentos no hay evidencia suficiente para subir la dificultad. */
const MIN_EVIDENCE = 4;

/**
 * Política adaptativa (pura y determinista). Se aplica al EMPEZAR cada secuencia y solo cambia cuántas reglas se
 * sortean y la complejidad de los enunciados (ver `WorldDefinition.sequence/generation`); nunca suaviza la mecánica
 * (un fallo o un timeout siguen siendo fallos directos).
 *
 *  - EASIER: el jugador está atascado — 3+ fallos seguidos, o precisión < 35 %, o la mitad de los intentos son
 *    timeouts (con evidencia suficiente).
 *  - HARDER: domina el mundo — ya lo completó y lleva racha ≥ 3, o precisión ≥ 80 % con evidencia suficiente y
 *    sin fallos recientes.
 *  - BASELINE en cualquier otro caso (incluido el jugador nuevo).
 */
export const adaptiveDifficultyPolicy: DifficultyPolicy = {
  selectDifficulty({ currentStreak, completionsCount, performance }) {
    if (performance === null || performance.attempts === 0) return 'BASELINE';
    const { attempts, accuracy, timeoutRate, consecutiveFailures } = performance;

    if (consecutiveFailures >= 3) return 'EASIER';
    if (attempts >= MIN_EVIDENCE && (accuracy < 0.35 || timeoutRate >= 0.5)) return 'EASIER';

    if (completionsCount > 0 && currentStreak >= 3) return 'HARDER';
    if (attempts >= MIN_EVIDENCE && accuracy >= 0.8 && consecutiveFailures === 0) return 'HARDER';

    return 'BASELINE';
  },
};

/** Política constante (pruebas y escenarios reproducibles). */
export const staticDifficultyPolicy: DifficultyPolicy = {
  selectDifficulty: () => 'BASELINE',
};

/** Resume el historial reciente (más reciente primero) en un `PlayerPerformanceSnapshot`. */
export function summarizePerformance(
  recentOutcomes: readonly ('CORRECT' | 'INCORRECT' | 'TIMEOUT')[],
): PlayerPerformanceSnapshot | null {
  if (recentOutcomes.length === 0) return null;
  const window = recentOutcomes.slice(0, DIFFICULTY_WINDOW);
  const correct = window.filter((outcome) => outcome === 'CORRECT').length;
  const timeouts = window.filter((outcome) => outcome === 'TIMEOUT').length;
  const firstCorrect = window.indexOf('CORRECT');
  return {
    attempts: window.length,
    accuracy: correct / window.length,
    timeoutRate: timeouts / window.length,
    consecutiveFailures: firstCorrect === -1 ? window.length : firstCorrect,
  };
}
