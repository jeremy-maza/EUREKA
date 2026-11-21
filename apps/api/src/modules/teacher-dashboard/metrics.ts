/**
 * Cálculos puros del panel docente (sin I/O). Convención de "no disponible" vs. "cero":
 *  - un CONTADOR sin actividad vale 0 (es un cero real: no hay intentos);
 *  - un PROMEDIO o PORCENTAJE cuyo denominador es 0 vale `null` (no se puede calcular; jamás se inventa 0).
 */

export interface RawMetrics {
  points: number;
  /** Intentos resueltos (acierto, fallo o timeout). Los PENDING no cuentan. */
  attempts: number;
  correct: number;
  incorrect: number;
  timeouts: number;
  /** Suma de tiempos (ms) de los aciertos: permite promediar entre estudiantes sin pérdida. */
  totalCorrectElapsedMs: number;
}

export const emptyMetrics = (): RawMetrics => ({
  points: 0,
  attempts: 0,
  correct: 0,
  incorrect: 0,
  timeouts: 0,
  totalCorrectElapsedMs: 0,
});

export function addMetrics(a: RawMetrics, b: RawMetrics): RawMetrics {
  return {
    points: a.points + b.points,
    attempts: a.attempts + b.attempts,
    correct: a.correct + b.correct,
    incorrect: a.incorrect + b.incorrect,
    timeouts: a.timeouts + b.timeouts,
    totalCorrectElapsedMs: a.totalCorrectElapsedMs + b.totalCorrectElapsedMs,
  };
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Porcentaje (1 decimal) o `null` si el denominador es 0. */
export function percent(part: number, total: number): number | null {
  return total > 0 ? round1((part / total) * 100) : null;
}

/** Precisión = aciertos / intentos resueltos. `null` si aún no hay intentos resueltos. */
export const accuracyPercent = (correct: number, attempts: number): number | null =>
  percent(correct, attempts);

/** Tiempo medio de los ACIERTOS (ms). El historial solo agrega tiempos de aciertos; `null` si no hay aciertos. */
export const averageCorrectMs = (totalCorrectElapsedMs: number, correct: number): number | null =>
  correct > 0 ? Math.round(totalCorrectElapsedMs / correct) : null;

export type AttentionReason = 'LOW_ACCURACY' | 'REPEATED_FAILURES';

export interface AttentionThresholds {
  /** Mínimo de intentos resueltos para juzgar la precisión (evita falsos positivos con pocos datos). */
  minAttempts: number;
  /** Precisión (%) por debajo de la cual se marca `LOW_ACCURACY`. */
  lowAccuracyBelow: number;
  /** Fallos consecutivos recientes a partir de los cuales se marca `REPEATED_FAILURES`. */
  repeatedFailures: number;
}

export interface StudentAttentionInput {
  attempts: number;
  accuracyPercent: number | null;
  consecutiveFailures: number;
}

/** Motivos por los que un estudiante requiere atención (lista vacía si no los hay). */
export function attentionReasons(input: StudentAttentionInput, t: AttentionThresholds): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (
    input.accuracyPercent !== null &&
    input.attempts >= t.minAttempts &&
    input.accuracyPercent < t.lowAccuracyBelow
  ) {
    reasons.push('LOW_ACCURACY');
  }
  if (t.repeatedFailures > 0 && input.consecutiveFailures >= t.repeatedFailures) {
    reasons.push('REPEATED_FAILURES');
  }
  return reasons;
}
