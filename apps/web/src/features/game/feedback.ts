import type { AnswerResult, Rule, Violation, WorldProgress } from '@/shared/api/types';

/**
 * Presentación de los resultados que decide el servidor. Aquí no se calcula nada del juego (puntos, multiplicador,
 * racha, reglas): solo se elige qué texto mostrar a partir de la respuesta de la API.
 */

/** Lo que el servidor conserva al reiniciar la secuencia (se lee de `progress`, nunca se deduce). */
export type KeptProgress = {
  totalPoints: number;
  streak: number;
  unlockedRules: Rule[];
};

/** Fin de la secuencia decidido por el servidor: respuesta incorrecta, regla violada o tiempo agotado. */
export type Failure = {
  title: string;
  message: string;
  violations: Violation[];
  /** Regla que introducía el reto fallido y que el servidor NO desbloqueó. */
  lostNewRule: Rule | null;
  kept: KeptProgress;
};

export type Success = {
  message: string;
  points: number;
  multiplier: string;
  streak: number;
  unlockedRule: Rule | null;
  worldCompleted: boolean;
};

export const TIMEOUT_TITLE = '¡Tiempo agotado!';
export const TIMEOUT_MESSAGE = 'Se acabó el tiempo para responder este desafío.';
const FAILURE_TITLE = '¡Secuencia terminada!';
const FALLBACK_MESSAGE = 'No pudimos aceptar tu respuesta.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Comprueba la forma mínima que la pantalla necesita; ante algo distinto, se trata como respuesta inesperada. */
export function isWorldProgress(value: unknown): value is WorldProgress {
  return (
    isRecord(value) &&
    typeof value.totalPoints === 'number' &&
    typeof value.streak === 'number' &&
    typeof value.nextMultiplier === 'string' &&
    Array.isArray(value.unlockedRules)
  );
}

export function isAnswerResult(value: unknown): value is AnswerResult {
  if (!isRecord(value) || !isWorldProgress(value.progress)) return false;
  if (value.outcome === 'CORRECT') return isRecord(value.score) && typeof value.score.points === 'number';
  return value.outcome === 'INCORRECT' || value.outcome === 'TIMEOUT';
}

export const keptFrom = (progress: WorldProgress): KeptProgress => ({
  totalPoints: progress.totalPoints,
  streak: progress.streak,
  unlockedRules: progress.unlockedRules,
});

/** La regla nueva del reto fallido solo cuenta como "no guardada" si el servidor no la tiene desbloqueada. */
export const isRuleUnlocked = (rule: Rule, progress: Pick<WorldProgress, 'unlockedRules'>) =>
  progress.unlockedRules.some((unlocked) => unlocked.key === rule.key);

const lostRule = (newRule: Rule | null, progress: WorldProgress) =>
  newRule && !isRuleUnlocked(newRule, progress) ? newRule : null;

/**
 * Texto de un fallo. Se usa el mensaje del servidor cuando es seguro mostrarlo. La excepción es `WRONG_RESULT`: el
 * servidor incluye ahí el resultado esperado, que no debe revelarse; se explica con el valor de la propia expresión.
 */
function failureText(result: AnswerResult): { title: string; message: string } {
  const serverMessage = typeof result.message === 'string' && result.message.trim() ? result.message : null;

  if (result.outcome === 'TIMEOUT' || result.failureReason === 'TIMEOUT') {
    return { title: TIMEOUT_TITLE, message: serverMessage ?? TIMEOUT_MESSAGE };
  }

  switch (result.failureReason) {
    case 'WRONG_RESULT':
      return {
        title: FAILURE_TITLE,
        message: result.evaluatedValue
          ? `Tu expresión vale ${result.evaluatedValue}, pero no da el mismo resultado que el desafío.`
          : 'Tu expresión no da el mismo resultado que el desafío.',
      };
    case 'RULE_VIOLATION':
      return {
        title: FAILURE_TITLE,
        message: 'El resultado es correcto, pero tu expresión no cumple todas las reglas activas.',
      };
    case 'SYNTAX_ERROR':
    case 'DIVISION_BY_ZERO':
      return {
        title: FAILURE_TITLE,
        message: `Tu expresión no es válida.${serverMessage ? ` ${serverMessage}` : ''}`,
      };
    default:
      // CLAIMED_RESULT_MISMATCH y cualquier otro motivo que informe el servidor.
      return { title: FAILURE_TITLE, message: serverMessage ?? FALLBACK_MESSAGE };
  }
}

export function describeFailure(result: AnswerResult, newRule: Rule | null): Failure {
  return {
    ...failureText(result),
    violations: Array.isArray(result.violations) ? result.violations : [],
    lostNewRule: lostRule(newRule, result.progress),
    kept: keptFrom(result.progress),
  };
}

/** Tiempo agotado confirmado por lecturas del servidor (historial + progreso): no hay mensaje del servidor que mostrar. */
export function describeTimeout(progress: WorldProgress, newRule: Rule | null): Failure {
  return {
    title: TIMEOUT_TITLE,
    message: TIMEOUT_MESSAGE,
    violations: [],
    lostNewRule: lostRule(newRule, progress),
    kept: keptFrom(progress),
  };
}

export function describeSuccess(result: AnswerResult): Success {
  return {
    message: result.message || '¡Correcto!',
    points: result.score.points,
    multiplier: result.score.multiplier,
    streak: result.progress.streak,
    unlockedRule: result.unlockedRule ?? null,
    worldCompleted: result.worldCompleted === true,
  };
}
