import type { AnswerResult, Rule, Violation, WorldProgress, WorldRef } from '@/services/api/types';

/**
 * Presentación de los resultados que decide el servidor. Aquí no se calcula nada del juego (puntos, multiplicador,
 * racha, reglas): solo se elige qué texto mostrar a partir de la respuesta de la API.
 */

/** Lo que el jugador conserva tras un fallo (se lee de `progress`, nunca se deduce). */
export type KeptProgress = {
  totalPoints: number;
  streak: number;
  /** Reglas dominadas: superadas alguna vez. Un fallo no las quita. */
  masteredRules: Rule[];
  /** Tamaño del repertorio del mundo (para «x de N»). */
  ruleCount: number | null;
};

/** Fin de la secuencia decidido por el servidor: respuesta incorrecta, regla violada, sintaxis o tiempo agotado. */
export type Failure = {
  title: string;
  message: string;
  violations: Violation[];
  /** Reglas de la secuencia que el fallo descartó: la próxima secuencia sorteará otras. */
  discardedRules: Rule[];
  /** Regla que introducía el reto fallido y que el jugador aún no domina. */
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
  nextWorldUnlocked: WorldRef | null;
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
  masteredRules: progress.unlockedRules,
  ruleCount: typeof progress.ruleCount === 'number' ? progress.ruleCount : null,
});

/** ¿El jugador ya domina la regla? (`unlockedRules` del servidor = reglas dominadas). */
export const isRuleMastered = (rule: Rule, progress: Pick<WorldProgress, 'unlockedRules'>) =>
  progress.unlockedRules.some((mastered) => mastered.key === rule.key);

const lostRule = (newRule: Rule | null, progress: WorldProgress) =>
  newRule && !isRuleMastered(newRule, progress) ? newRule : null;

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

/**
 * `activeRules` (las reglas del reto mostrado) solo se usa si el servidor no envía `discardedRules`: el servidor es
 * quien decide qué se descarta.
 */
export function describeFailure(result: AnswerResult, newRule: Rule | null, activeRules: Rule[]): Failure {
  return {
    ...failureText(result),
    violations: Array.isArray(result.violations) ? result.violations : [],
    discardedRules: Array.isArray(result.discardedRules) ? result.discardedRules : activeRules,
    lostNewRule: lostRule(newRule, result.progress),
    kept: keptFrom(result.progress),
  };
}

/**
 * Tiempo agotado confirmado por lecturas del servidor (historial + progreso): no hay respuesta del servidor con
 * `discardedRules`, así que se listan las reglas activas del reto que venció (las de la secuencia terminada).
 */
export function describeTimeout(progress: WorldProgress, newRule: Rule | null, activeRules: Rule[]): Failure {
  return {
    title: TIMEOUT_TITLE,
    message: TIMEOUT_MESSAGE,
    violations: [],
    discardedRules: activeRules,
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
    nextWorldUnlocked: result.nextWorldUnlocked ?? null,
  };
}
