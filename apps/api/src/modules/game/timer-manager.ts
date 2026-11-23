export interface TimerConfig {
  /** Tiempo base (segundos) con una sola regla activa. */
  baseTimeSeconds: number;
  /** Segundos adicionales por cada regla activa más allá de la primera. */
  additionalTimePerRuleSeconds: number;
}

export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  baseTimeSeconds: 60,
  additionalTimePerRuleSeconds: 15,
};

export interface TimingCheck {
  withinTime: boolean;
  /** Milisegundos transcurridos entre el inicio y el envío (reloj del servidor). */
  elapsedMs: number;
}

/**
 * Cálculo del tiempo límite y comprobación de plazos.
 *   timeLimit = baseTime + (activeRulesCount − 1) · additionalTimePerRule + extraSeconds
 * (`extraSeconds` lo fija cada mundo, p. ej. para resolver ecuaciones; 0 por defecto).
 *
 * Es puro: recibe instantes explícitos (`Date`) en lugar de leer el reloj. Quien lo use en el
 * backend debe pasar SIEMPRE marcas de tiempo del servidor, nunca las del cliente.
 *
 * Supuesto: el primer reto parte sin reglas acumuladas; `activeRulesCount` se acota a >= 1, de modo
 * que el reto inicial (y el segundo, con una sola regla) reciben el tiempo base.
 */
export class TimerManager {
  constructor(private readonly config: TimerConfig = DEFAULT_TIMER_CONFIG) {
    if (!Number.isFinite(config.baseTimeSeconds) || config.baseTimeSeconds <= 0) {
      throw new RangeError('baseTimeSeconds debe ser un número > 0.');
    }
    if (!Number.isFinite(config.additionalTimePerRuleSeconds) || config.additionalTimePerRuleSeconds < 0) {
      throw new RangeError('additionalTimePerRuleSeconds debe ser un número >= 0.');
    }
  }

  calculateTimeLimitSeconds(activeRulesCount: number, extraSeconds = 0): number {
    if (!Number.isInteger(activeRulesCount) || activeRulesCount < 0) {
      throw new RangeError('activeRulesCount debe ser un entero >= 0.');
    }
    if (!Number.isInteger(extraSeconds) || extraSeconds < 0) {
      throw new RangeError('extraSeconds debe ser un entero >= 0.');
    }
    const effectiveCount = Math.max(1, activeRulesCount);
    return (
      this.config.baseTimeSeconds +
      (effectiveCount - 1) * this.config.additionalTimePerRuleSeconds +
      extraSeconds
    );
  }

  calculateDeadline(startedAt: Date, activeRulesCount: number, extraSeconds = 0): Date {
    return new Date(
      startedAt.getTime() + this.calculateTimeLimitSeconds(activeRulesCount, extraSeconds) * 1000,
    );
  }

  /** Un envío exactamente en el instante límite se considera a tiempo. */
  checkSubmission(startedAt: Date, deadlineAt: Date, submittedAt: Date): TimingCheck {
    return {
      withinTime: submittedAt.getTime() <= deadlineAt.getTime(),
      elapsedMs: submittedAt.getTime() - startedAt.getTime(),
    };
  }

  isExpired(deadlineAt: Date, now: Date): boolean {
    return now.getTime() > deadlineAt.getTime();
  }
}
