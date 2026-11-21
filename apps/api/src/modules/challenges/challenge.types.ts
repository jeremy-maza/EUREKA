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
   * Solución de referencia. Debe cumplir TODAS las reglas del mundo: así el reto sigue
   * siendo resoluble aunque el jugador reinicie la secuencia con todas las reglas activas.
   * Nunca se expone a los estudiantes.
   */
  referenceSolution: string;
}

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
