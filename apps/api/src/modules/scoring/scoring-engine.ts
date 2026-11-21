import { BASE_MULTIPLIER_MILLI, StreakManager } from './streak-manager';

export interface ScoringConfig {
  /** Puntos base por acierto (entero). */
  basePoints: number;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = { basePoints: 100 };

/** Resultado de puntuar un intento. Se persiste tal cual como `ScoreTransaction`. */
export interface ScoreAward {
  basePoints: number;
  /** Multiplicador en milésimas (1500 = 1.5x). 0 si no hubo acierto. */
  multiplierMilli: number;
  /** Puntos concedidos (entero). */
  points: number;
  /** Racha resultante tras el intento. */
  streakAfter: number;
}

/**
 * Calcula puntos con aritmética entera: `points = ⌊basePoints · multiplierMilli / 1000⌋`.
 * El servidor es la única fuente de puntuación; el cliente nunca envía puntos.
 */
export class ScoringEngine {
  constructor(
    private readonly config: ScoringConfig,
    private readonly streaks: StreakManager,
  ) {
    if (!Number.isSafeInteger(config.basePoints) || config.basePoints < 0) {
      throw new RangeError('basePoints debe ser un entero >= 0.');
    }
  }

  scoreCorrect(currentStreak: number): ScoreAward {
    const streakAfter = this.streaks.onCorrect(currentStreak);
    const multiplierMilli = this.streaks.multiplierMilliFor(streakAfter);
    const scaled = this.config.basePoints * multiplierMilli;
    const points = (scaled - (scaled % BASE_MULTIPLIER_MILLI)) / BASE_MULTIPLIER_MILLI;
    return { basePoints: this.config.basePoints, multiplierMilli, points, streakAfter };
  }

  /** Un fallo no otorga puntos ni descuenta los ya ganados; solo reinicia la racha. */
  scoreFailure(): ScoreAward {
    return { basePoints: 0, multiplierMilli: 0, points: 0, streakAfter: this.streaks.onFailure() };
  }
}
