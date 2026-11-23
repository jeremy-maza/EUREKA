import { RuleViolation } from './rules';

/** Reto del catálogo. Referencia (no contiene) la regla que introduce. */
export interface ChallengeDefinition {
  /** Identificador estable, p. ej. "arithmetic-002". */
  id: string;
  /** Posición (1-based) dentro de la secuencia del mundo. */
  position: number;
  /** Enunciado mostrado al jugador, p. ej. "3 * 7". */
  expression: string;
  /** Resultado esperado en forma canónica ("21", "7/2"). */
  expectedResult: string;
  /** Id de la regla que este reto desbloquea, si alguna. */
  introducesRuleId: string | null;
  /**
   * Solución de referencia: una respuesta correcta con las reglas activas en la posición del reto (en una
   * secuencia planificada, `ruleIds.slice(0, position - 1)`) y la sintaxis del mundo; lo comprueba
   * `ChallengeEngine.verifySolvable`. Nunca se expone a los estudiantes.
   */
  referenceSolution: string;
  /**
   * Tipo de enunciado (por defecto `EXPRESSION`):
   *  - `EXPRESSION`: `expression` es una operación evaluable; la respuesta debe valer lo mismo.
   *  - `EQUATION`: `expression` es una ecuación lineal en `x` (p. ej. "3 * x + 4 = 19"); la respuesta debe valer
   *    la solución `x` (= `expectedResult`). El enunciado no es una respuesta válida (contiene `x`).
   */
  statementKind?: StatementKind;
}

export type StatementKind = 'EXPRESSION' | 'EQUATION';

export type EvaluationFailureReason =
  'SYNTAX_ERROR' | 'DIVISION_BY_ZERO' | 'WRONG_RESULT' | 'CLAIMED_RESULT_MISMATCH' | 'RULE_VIOLATION';

export interface SubmissionEvaluation {
  isCorrect: boolean;
  failureReason: EvaluationFailureReason | null;
  /** Mensaje listo para mostrar al jugador. */
  message: string;
  /** Valor de la expresión en forma canónica, si pudo evaluarse. */
  value: string | null;
  /** Reglas incumplidas (se calculan aunque el resultado también sea incorrecto). */
  violations: RuleViolation[];
}

export interface SolvabilityReport {
  solvable: boolean;
  /** Motivo si no es resoluble. */
  reason: string | null;
}
