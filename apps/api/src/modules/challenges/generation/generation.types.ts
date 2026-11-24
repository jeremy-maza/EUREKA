import { ChallengeDefinition } from '../challenge.types';
import { DEFAULT_MAX_EXPRESSION_LENGTH } from '../math';
import { RuleDefinition } from '../rules';
import { RuleConflict, RuleIssue } from './rule-compatibility';

/** Versión del generador; viaja en los metadatos de cada reto generado. */
export const CHALLENGE_GENERATOR_VERSION = 'multiplicative-v1';

/** Plantillas de la familia multiplicativa inicial. */
export type TemplateId = 'PRODUCT_CHAIN' | 'PRODUCT_QUOTIENT' | 'PRODUCT_SUM' | 'PARENTHESIZED_SUM_PRODUCT';

/**
 * Complejidad estructural permitida (cada nivel incluye los anteriores):
 *   PRODUCT → `a * b * c`
 *   MIXED   → + cociente (`a * b / c`) y sumas/restas de productos (`a * b + c`)
 *   NESTED  → + sumas entre paréntesis (`(a + b) * c`)
 */
export type TemplateComplexity = 'PRODUCT' | 'MIXED' | 'NESTED';

export interface IntegerRange {
  min: number;
  max: number;
}

/** Perfil de dificultad mínimo y estático (no hay dificultad adaptativa ni datos de jugador). */
export interface ChallengeDifficultyProfile {
  /** Rango (inclusive) de los operandos del enunciado. 1 ≤ min ≤ max ≤ 9999. */
  operandRange: IntegerRange;
  /** Cantidad de literales del enunciado. 2 ≤ min ≤ max ≤ 8. */
  operandCount: IntegerRange;
  complexity: TemplateComplexity;
  /** Si es `false` (por defecto) el resultado esperado siempre es un entero. */
  allowFractions: boolean;
}

export const DEFAULT_DIFFICULTY_PROFILE: ChallengeDifficultyProfile = {
  operandRange: { min: 2, max: 12 },
  operandCount: { min: 2, max: 3 },
  complexity: 'MIXED',
  allowFractions: false,
};

/** Presupuestos deterministas (nunca de reloj) que acotan la generación. */
export interface GenerationLimits {
  /** Plantillas candidatas que se examinan como máximo. */
  maxCandidates: number;
  /** Intentos de construir la solución de referencia por candidato. */
  maxWitnessAttemptsPerCandidate: number;
  /** Longitud máxima del texto (enunciado y solución). Nunca supera el límite del parser. */
  maxExpressionLength: number;
}

export const DEFAULT_GENERATION_LIMITS: GenerationLimits = {
  maxCandidates: 200,
  maxWitnessAttemptsPerCandidate: 4,
  maxExpressionLength: DEFAULT_MAX_EXPRESSION_LENGTH,
};

export interface ChallengeGenerationRequest {
  /** Posición (1-based) del reto en la secuencia. En la 1 no se exige que el reto "muerda". */
  position: number;
  /** Reglas activas: las acumuladas + la que introduce este reto. */
  activeRules: readonly RuleDefinition[];
  /** Regla que desbloquea este reto (debe estar en `activeRules`). */
  introducesRuleId?: string | null;
  /** Semilla explícita (entero seguro): misma petición + misma semilla ⇒ mismo resultado. */
  seed: number;
  profile?: Partial<ChallengeDifficultyProfile>;
  /** Huellas ya usadas que no se deben repetir. */
  avoidFingerprints?: Iterable<string>;
  limits?: Partial<GenerationLimits>;
  /** Id del reto resultante; por defecto `generated-<position>-<huella corta>`. */
  challengeId?: string;
}

/** Motivos por los que un candidato se descarta. */
export type CandidateRejection =
  | 'INVALID_STATEMENT'
  | 'NON_POSITIVE_RESULT'
  | 'FRACTIONAL_RESULT'
  | 'DUPLICATE'
  | 'NOT_BINDING'
  | 'NO_WITNESS'
  | 'VERIFICATION_FAILED';

export const CANDIDATE_REJECTIONS: readonly CandidateRejection[] = [
  'INVALID_STATEMENT',
  'NON_POSITIVE_RESULT',
  'FRACTIONAL_RESULT',
  'DUPLICATE',
  'NOT_BINDING',
  'NO_WITNESS',
  'VERIFICATION_FAILED',
];

export interface GenerationDiagnostics {
  limits: GenerationLimits;
  candidatesTried: number;
  witnessAttempts: number;
  rejections: Record<CandidateRejection, number>;
}

/** Resultado de comprobar que el reto "muerde" (no se evade con el enunciado ni con el resultado literal). */
export interface BindingReport {
  /** `false` en la posición 1 o sin reglas activas: no hay nada que exigir. */
  enforced: boolean;
  /** Reglas que rechazan enviar el enunciado tal cual. */
  statementViolations: readonly string[];
  /** Reglas que rechazan enviar directamente el resultado. */
  resultViolations: readonly string[];
}

export interface GeneratedChallengeMetadata {
  fingerprint: string;
  generatorVersion: string;
  templateId: TemplateId;
  seed: number;
  /** Índice (0-based) del candidato aceptado dentro del presupuesto. */
  candidateIndex: number;
  witnessStrategy: string;
  binding: BindingReport;
  diagnostics: GenerationDiagnostics;
}

export type GenerationFailure =
  | { code: 'INVALID_REQUEST'; message: string; problems: readonly string[] }
  | { code: 'INVALID_RULE_CONFIG'; message: string; issues: readonly RuleIssue[] }
  | { code: 'UNSUPPORTED_RULE'; message: string; issues: readonly RuleIssue[] }
  | { code: 'INCOMPATIBLE_RULES'; message: string; conflicts: readonly RuleConflict[] }
  | { code: 'GENERATION_EXHAUSTED'; message: string; diagnostics: GenerationDiagnostics };

export type GenerationResult =
  | { ok: true; challenge: ChallengeDefinition; metadata: GeneratedChallengeMetadata }
  | { ok: false; failure: GenerationFailure };
