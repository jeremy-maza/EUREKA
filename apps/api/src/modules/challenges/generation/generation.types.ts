import { ChallengeDefinition, StatementKind } from '../challenge.types';
import { DEFAULT_MAX_EXPRESSION_LENGTH, MathSyntax } from '../math';
import { RuleDefinition } from '../rules';
import { RuleConflict, RuleIssue } from './rule-compatibility';

/** Versión del generador; viaja en los metadatos de cada reto generado (y se guarda con cada secuencia). */
export const CHALLENGE_GENERATOR_VERSION = 'families-v2';

/**
 * Familias de enunciados. Cada mundo elige (con pesos) las suyas en `WorldGenerationConfig`.
 *  - MULTIPLICATIVE: productos, cocientes exactos y sumas de productos (Mundo 1).
 *  - SIGNED: operaciones con números negativos y resultados con signo (Mundo 2).
 *  - FRACTIONAL: sumas/productos de fracciones (resultado racional).
 *  - DECIMAL: operaciones con decimales exactos (requiere `MathSyntax.decimals`).
 *  - POWER: potencias de exponente entero (requiere `MathSyntax.powers`).
 *  - LINEAR_EQUATION: ecuación lineal en x; la respuesta es una expresión que vale la solución.
 */
export type StatementFamily =
  'MULTIPLICATIVE' | 'SIGNED' | 'FRACTIONAL' | 'DECIMAL' | 'POWER' | 'LINEAR_EQUATION';

export const STATEMENT_FAMILIES: readonly StatementFamily[] = [
  'MULTIPLICATIVE',
  'SIGNED',
  'FRACTIONAL',
  'DECIMAL',
  'POWER',
  'LINEAR_EQUATION',
];

/** Plantilla concreta (dentro de su familia) con la que se escribió un enunciado. */
export type TemplateId =
  // MULTIPLICATIVE
  | 'PRODUCT_CHAIN'
  | 'PRODUCT_QUOTIENT'
  | 'PRODUCT_SUM'
  | 'PARENTHESIZED_SUM_PRODUCT'
  // SIGNED
  | 'SIGNED_SUM'
  | 'SIGNED_PRODUCT'
  | 'SIGNED_DIFFERENCE'
  | 'SIGNED_NESTED'
  // FRACTIONAL
  | 'FRACTION_SUM'
  | 'FRACTION_PRODUCT'
  | 'FRACTION_OF_INTEGER'
  | 'MIXED_NUMBER'
  | 'FRACTION_NESTED'
  // DECIMAL
  | 'DECIMAL_SUM'
  | 'DECIMAL_PRODUCT'
  | 'DECIMAL_QUOTIENT'
  | 'DECIMAL_NESTED'
  // POWER
  | 'POWER_SUM'
  | 'POWER_PRODUCT'
  | 'POWER_NESTED'
  // LINEAR_EQUATION
  | 'EQ_AX'
  | 'EQ_AX_B'
  | 'EQ_X_OVER_A'
  | 'EQ_A_PAREN'
  | 'EQ_BOTH_SIDES'
  | 'EQ_PAREN_PLUS';

/** Familia con su peso relativo (entero ≥ 1) en el sorteo de cada candidato. */
export interface WeightedFamily {
  family: StatementFamily;
  weight: number;
}

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
  /**
   * Si es `false` (por defecto) el resultado esperado siempre es un entero. Las familias FRACTIONAL y
   * DECIMAL producen racionales siempre; en las ecuaciones permite soluciones no enteras.
   */
  allowFractions: boolean;
  /**
   * Admite resultados (o soluciones) negativos en FRACTIONAL, DECIMAL, POWER y LINEAR_EQUATION
   * (por defecto `false`). SIGNED siempre los admite; MULTIPLICATIVE nunca.
   */
  allowNegative: boolean;
  /**
   * Mayor |resultado| (o |solución|) aceptado, para que los retos sigan siendo resolubles a mano a tiempo.
   * Opcional: sin él no hay más tope que el de cada familia (la multiplicativa no tiene ninguno).
   */
  maxResult?: number;
}

export const DEFAULT_DIFFICULTY_PROFILE: ChallengeDifficultyProfile = {
  operandRange: { min: 2, max: 12 },
  operandCount: { min: 2, max: 3 },
  complexity: 'MIXED',
  allowFractions: false,
  allowNegative: false,
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
  /** Familias de enunciados (con pesos). Por defecto solo MULTIPLICATIVE, el comportamiento original. */
  families?: readonly WeightedFamily[];
  /** Sintaxis del mundo: la del enunciado, la de la solución y la de la verificación. Por defecto la del Mundo 1. */
  syntax?: MathSyntax;
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
  | 'UNSUITABLE_RESULT'
  | 'DUPLICATE'
  | 'NOT_BINDING'
  | 'NO_WITNESS'
  | 'VERIFICATION_FAILED';

export const CANDIDATE_REJECTIONS: readonly CandidateRejection[] = [
  'INVALID_STATEMENT',
  'NON_POSITIVE_RESULT',
  'FRACTIONAL_RESULT',
  'UNSUITABLE_RESULT',
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

/**
 * Resultado de comprobar que el reto "muerde" (no se evade con el enunciado ni con el resultado literal).
 * El resultado literal se prueba en todas sus escrituras: la canónica (`-3`, `7/2`) y, en mundos con
 * decimales, la decimal exacta (`3.5`). Una ecuación no se puede enviar como respuesta (contiene `x`), así
 * que en ellas solo se exige que muerda el resultado.
 */
export interface BindingReport {
  /** `false` en la posición 1 o sin reglas activas: no hay nada que exigir. */
  enforced: boolean;
  /** Reglas que rechazan enviar el enunciado tal cual (vacío en ecuaciones). */
  statementViolations: readonly string[];
  /** Reglas que rechazan enviar directamente el resultado (unión de todas sus escrituras). */
  resultViolations: readonly string[];
}

export interface GeneratedChallengeMetadata {
  fingerprint: string;
  generatorVersion: string;
  templateId: TemplateId;
  family: StatementFamily;
  statementKind: StatementKind;
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

/** Mismo literal que `DifficultyLevel` de `modules/worlds` (aquí para no invertir la dependencia). */
export type DifficultyLevelName = 'EASIER' | 'BASELINE' | 'HARDER';
