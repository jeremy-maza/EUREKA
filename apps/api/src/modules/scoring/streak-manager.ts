export interface StreakConfig {
  /** Incremento del multiplicador por acierto consecutivo, en milésimas (500 = +0.5x). */
  multiplierStepMilli: number;
  /** Tope del multiplicador, en milésimas (5000 = 5x). */
  maxMultiplierMilli: number;
}

export const BASE_MULTIPLIER_MILLI = 1000;

export const DEFAULT_STREAK_CONFIG: StreakConfig = {
  multiplierStepMilli: 500,
  maxMultiplierMilli: 5000,
};

/**
 * Racha por mundo y su multiplicador. Todo en enteros ("milésimas") para evitar coma flotante:
 *   M(n) = min(1 + 0.5 · (n − 1), 5)   ⇒   milli(n) = min(1000 + 500 · (n − 1), 5000)
 * donde n es el número de acierto consecutivo (el primero cuenta como n = 1).
 */
export class StreakManager {
  constructor(private readonly config: StreakConfig = DEFAULT_STREAK_CONFIG) {
    if (!Number.isInteger(config.multiplierStepMilli) || config.multiplierStepMilli < 0) {
      throw new RangeError('multiplierStepMilli debe ser un entero >= 0.');
    }
    if (!Number.isInteger(config.maxMultiplierMilli) || config.maxMultiplierMilli < BASE_MULTIPLIER_MILLI) {
      throw new RangeError(`maxMultiplierMilli debe ser un entero >= ${BASE_MULTIPLIER_MILLI}.`);
    }
  }

  /** Multiplicador (en milésimas) del n-ésimo acierto consecutivo. */
  multiplierMilliFor(consecutiveCorrect: number): number {
    if (!Number.isInteger(consecutiveCorrect) || consecutiveCorrect < 1) {
      throw new RangeError('El número de aciertos consecutivos debe ser un entero >= 1.');
    }
    const uncapped = BASE_MULTIPLIER_MILLI + this.config.multiplierStepMilli * (consecutiveCorrect - 1);
    return Math.min(uncapped, this.config.maxMultiplierMilli);
  }

  /** Racha tras un acierto. */
  onCorrect(currentStreak: number): number {
    return currentStreak + 1;
  }

  /** Racha tras un fallo o timeout. */
  onFailure(): number {
    return 0;
  }
}
