import { DEFAULT_MAX_EXPRESSION_LENGTH, isCommutative } from '../math';
import {
  FORBIDDEN_DIGIT,
  ForbiddenDigitConfig,
  REQUIRED_OPERATION,
  RequiredOperationConfig,
  RuleConfigurationError,
  RuleDefinition,
  RuleEngine,
  UnknownRuleTypeError,
  createDefaultRuleEngine,
  forbiddenDigitRule,
  requiredOperationRule,
} from '../rules';

/** Tipos de regla para los que el generador sabe construir soluciones. */
export const GENERATOR_SUPPORTED_RULE_TYPES: readonly string[] = [FORBIDDEN_DIGIT, REQUIRED_OPERATION];

/** Restricciones ya parseadas (con los handlers del `RuleEngine`) de un conjunto de reglas soportadas. */
export interface RuleConstraints {
  /** Reglas originales: son la fuente de verdad para validar con `RuleEngine`. */
  rules: readonly RuleDefinition[];
  /** Dígitos prohibidos, sin repetir y en orden ascendente. */
  forbiddenDigits: readonly number[];
  /** Operaciones exigidas, sin repetir (`7 * 1` ≡ `1 * 7`). */
  requiredOperations: readonly RequiredOperationConfig[];
}

export type RuleConflictCode =
  | 'REQUIRED_OPERATION_DIVISION_BY_ZERO'
  | 'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL'
  | 'ALL_DIGITS_FORBIDDEN'
  | 'REQUIRED_OPERATIONS_EXCEED_MAX_LENGTH';

/** Incompatibilidad DEMOSTRADA (no una limitación del constructor de soluciones). */
export interface RuleConflict {
  code: RuleConflictCode;
  message: string;
  ruleIds: readonly string[];
}

export type RuleIssueCode =
  'UNKNOWN_RULE_TYPE' | 'RULE_TYPE_NOT_SUPPORTED_BY_GENERATOR' | 'INVALID_RULE_CONFIG';

export interface RuleIssue {
  code: RuleIssueCode;
  ruleId: string;
  ruleType: string;
  message: string;
}

/**
 * Resultado de la comprobación previa. Prioridad cuando hay varios problemas:
 * `INVALID_CONFIG` > `UNSUPPORTED` > `INCOMPATIBLE`. Los conflictos solo se analizan cuando TODAS las
 * reglas son analizables.
 *
 * `NO_CONFLICT_FOUND` significa "no se ha demostrado ninguna incompatibilidad": es una condición
 * necesaria, NO suficiente, para que exista un reto generable.
 */
export type RuleCompatibilityResult =
  | { status: 'NO_CONFLICT_FOUND'; constraints: RuleConstraints }
  | { status: 'INCOMPATIBLE'; conflicts: RuleConflict[] }
  | { status: 'UNSUPPORTED'; issues: RuleIssue[] }
  | { status: 'INVALID_CONFIG'; issues: RuleIssue[] };

export interface RuleCompatibilityOptions {
  ruleEngine?: RuleEngine;
  /** Longitud máxima del texto de una expresión (por defecto, la del parser). */
  maxExpressionLength?: number;
}

const ALL_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * Detecta, SIN intentar generar nada, combinaciones de reglas que no admiten ninguna solución.
 *
 * Solo se declara incompatibilidad cuando se puede demostrar a partir de la semántica real de las reglas:
 *
 *  1. `REQUIRED_OPERATION` con `/ 0`: el evaluador recorre todos los nodos, así que toda expresión que
 *     contenga el nodo `x / 0` lanza `DivisionByZeroError`; ninguna solución es evaluable.
 *  2. `FORBIDDEN_DIGIT(d)` + `REQUIRED_OPERATION` con un literal `v`: la regla exige un nodo cuyos operandos
 *     sean literales con valor `v`. Cualquier texto con valor `v` es `0…0` + los dígitos canónicos de `v`,
 *     así que contiene `d` si y solo si `String(v)` lo contiene (los ceros extra solo pueden empeorar el
 *     caso `d = 0`). Por eso `FORBIDDEN_DIGIT(7)` + `7 * 1` es imposible.
 *  3. Los 10 dígitos prohibidos: toda expresión tiene al menos un literal con al menos un dígito.
 *  4. Longitud: cada operación exigida distinta necesita su propio nodo con dos literales propios, y los
 *     nodos se enlazan con operadores; si el mínimo textual supera el máximo del parser, es imposible.
 *
 * Cualquier otra cosa (p. ej. "no he sabido construir una solución") NO es una incompatibilidad.
 */
export function checkRuleCompatibility(
  rules: readonly RuleDefinition[],
  options: RuleCompatibilityOptions = {},
): RuleCompatibilityResult {
  const ruleEngine = options.ruleEngine ?? createDefaultRuleEngine();
  const maxLength = options.maxExpressionLength ?? DEFAULT_MAX_EXPRESSION_LENGTH;

  const invalid: RuleIssue[] = [];
  const unsupported: RuleIssue[] = [];
  const forbidden: Array<{ rule: RuleDefinition; config: ForbiddenDigitConfig }> = [];
  const required: Array<{ rule: RuleDefinition; config: RequiredOperationConfig }> = [];

  for (const rule of rules) {
    // 1) Validez según el RuleEngine (tipo conocido + configuración parseable): fuente de verdad.
    try {
      ruleEngine.assertValidDefinition(rule);
    } catch (error) {
      if (error instanceof UnknownRuleTypeError) {
        unsupported.push(issue('UNKNOWN_RULE_TYPE', rule, error.message));
      } else if (error instanceof RuleConfigurationError) {
        invalid.push(issue('INVALID_RULE_CONFIG', rule, error.message));
      } else {
        throw error;
      }
      continue;
    }

    // 2) Tipos que el motor conoce pero el generador no sabe satisfacer.
    if (rule.type === FORBIDDEN_DIGIT) {
      forbidden.push({ rule, config: forbiddenDigitRule.parseConfig(rule.config) });
    } else if (rule.type === REQUIRED_OPERATION) {
      required.push({ rule, config: requiredOperationRule.parseConfig(rule.config) });
    } else {
      unsupported.push(
        issue(
          'RULE_TYPE_NOT_SUPPORTED_BY_GENERATOR',
          rule,
          `El generador no soporta el tipo de regla "${rule.type}" (regla "${rule.id}").`,
        ),
      );
    }
  }

  if (invalid.length > 0) return { status: 'INVALID_CONFIG', issues: invalid };
  if (unsupported.length > 0) return { status: 'UNSUPPORTED', issues: unsupported };

  const conflicts = findConflicts(forbidden, required, maxLength);
  if (conflicts.length > 0) return { status: 'INCOMPATIBLE', conflicts };

  return {
    status: 'NO_CONFLICT_FOUND',
    constraints: {
      rules,
      forbiddenDigits: [...new Set(forbidden.map(({ config }) => config.digit))].sort((a, b) => a - b),
      requiredOperations: uniqueOperations(required.map(({ config }) => config)),
    },
  };
}

function issue(code: RuleIssueCode, rule: RuleDefinition, message: string): RuleIssue {
  return { code, ruleId: rule.id, ruleType: rule.type, message };
}

type ForbiddenEntry = { rule: RuleDefinition; config: ForbiddenDigitConfig };
type RequiredEntry = { rule: RuleDefinition; config: RequiredOperationConfig };

function findConflicts(
  forbidden: readonly ForbiddenEntry[],
  required: readonly RequiredEntry[],
  maxLength: number,
): RuleConflict[] {
  const conflicts: RuleConflict[] = [];

  for (const { rule, config } of required) {
    if (config.operator === '/' && config.right === 0) {
      conflicts.push({
        code: 'REQUIRED_OPERATION_DIVISION_BY_ZERO',
        message: `La regla "${rule.id}" exige ${config.left} / 0: toda expresión que la contenga divide entre cero.`,
        ruleIds: [rule.id],
      });
    }
  }

  for (const f of forbidden) {
    for (const r of required) {
      const blocked = [r.config.left, r.config.right].filter((literal) =>
        String(literal).includes(String(f.config.digit)),
      );
      if (blocked.length > 0) {
        conflicts.push({
          code: 'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL',
          message:
            `La regla "${f.rule.id}" prohíbe el dígito ${f.config.digit}, pero "${r.rule.id}" exige ` +
            `${r.config.left} ${r.config.operator} ${r.config.right}, cuyo literal ${blocked[0]} lo contiene.`,
          ruleIds: [f.rule.id, r.rule.id],
        });
      }
    }
  }

  const forbiddenDigits = new Set(forbidden.map(({ config }) => config.digit));
  if (ALL_DIGITS.every((digit) => forbiddenDigits.has(digit))) {
    conflicts.push({
      code: 'ALL_DIGITS_FORBIDDEN',
      message: 'Están prohibidos los 10 dígitos: no se puede escribir ningún número.',
      ruleIds: forbidden.map(({ rule }) => rule.id),
    });
  }

  const distinct = uniqueOperations(required.map(({ config }) => config));
  if (distinct.length > 0) {
    // Mínimo de caracteres: operandos + operador de cada operación + (k - 1) operadores de enlace.
    const minimumLength =
      distinct.reduce((sum, op) => sum + String(op.left).length + 1 + String(op.right).length, 0) +
      (distinct.length - 1);
    if (minimumLength > maxLength) {
      conflicts.push({
        code: 'REQUIRED_OPERATIONS_EXCEED_MAX_LENGTH',
        message: `Las operaciones exigidas necesitan al menos ${minimumLength} caracteres y el máximo es ${maxLength}.`,
        ruleIds: required.map(({ rule }) => rule.id),
      });
    }
  }

  return conflicts;
}

function operationKey(op: RequiredOperationConfig): string {
  const [a, b] = isCommutative(op.operator)
    ? [Math.min(op.left, op.right), Math.max(op.left, op.right)]
    : [op.left, op.right];
  return `${op.operator}:${a}:${b}`;
}

/** Elimina operaciones equivalentes (una sola expresión `7 * 1` satisface `7 * 1` y `1 * 7`). */
function uniqueOperations(operations: readonly RequiredOperationConfig[]): RequiredOperationConfig[] {
  const seen = new Map<string, RequiredOperationConfig>();
  for (const op of operations) if (!seen.has(operationKey(op))) seen.set(operationKey(op), op);
  return [...seen.values()];
}
