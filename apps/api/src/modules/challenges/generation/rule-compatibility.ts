import {
  BINARY_OPERATORS,
  BinaryOperator,
  DEFAULT_MATH_SYNTAX,
  DEFAULT_MAX_EXPRESSION_LENGTH,
  Fraction,
  MathError,
  MathSyntax,
  evaluatePower,
  isCommutative,
} from '../math';
import {
  FORBIDDEN_DIGIT,
  FORBIDDEN_OPERATOR,
  MAX_NUMBER,
  MIN_NUMBERS,
  OPERATOR_NAMES,
  REQUIRED_DECIMAL,
  REQUIRED_NEGATIVE,
  REQUIRED_OPERATION,
  REQUIRED_OPERATOR,
  REQUIRED_PARENTHESES,
  RequiredOperationConfig,
  RuleConfigurationError,
  RuleDefinition,
  RuleEngine,
  UnknownRuleTypeError,
  createDefaultRuleEngine,
  forbiddenDigitRule,
  forbiddenOperatorRule,
  maxNumberRule,
  minNumbersRule,
  requiredOperationRule,
  requiredOperatorRule,
} from '../rules';

/** Tipos de regla para los que el generador sabe construir soluciones. */
export const GENERATOR_SUPPORTED_RULE_TYPES: readonly string[] = [
  FORBIDDEN_DIGIT,
  REQUIRED_OPERATION,
  REQUIRED_OPERATOR,
  FORBIDDEN_OPERATOR,
  MIN_NUMBERS,
  MAX_NUMBER,
  REQUIRED_NEGATIVE,
  REQUIRED_DECIMAL,
  REQUIRED_PARENTHESES,
];

/** Restricciones ya parseadas (con los handlers del `RuleEngine`) de un conjunto de reglas soportadas. */
export interface RuleConstraints {
  /** Reglas originales: son la fuente de verdad para validar con `RuleEngine`. */
  rules: readonly RuleDefinition[];
  /** Sintaxis del mundo en la que hay que escribir la solución. */
  syntax: MathSyntax;
  /** Dígitos prohibidos, sin repetir y en orden ascendente. */
  forbiddenDigits: readonly number[];
  /** Operaciones exigidas, sin repetir (`7 * 1` ≡ `1 * 7`). */
  requiredOperations: readonly RequiredOperationConfig[];
  /** Operadores binarios exigidos / prohibidos, sin repetir y en el orden de `BINARY_OPERATORS`. */
  requiredOperators: readonly BinaryOperator[];
  forbiddenOperators: readonly BinaryOperator[];
  /** Cantidad mínima de literales (0 = sin mínimo). */
  minNumbers: number;
  /** Mayor valor admitido para cada literal (`null` = sin límite). */
  maxNumber: number | null;
  requireNegative: boolean;
  requireDecimal: boolean;
  requireParentheses: boolean;
}

/** Restricciones sin ninguna regla (útil en pruebas y como base). */
export function emptyRuleConstraints(syntax: MathSyntax = DEFAULT_MATH_SYNTAX): RuleConstraints {
  return {
    rules: [],
    syntax,
    forbiddenDigits: [],
    requiredOperations: [],
    requiredOperators: [],
    forbiddenOperators: [],
    minNumbers: 0,
    maxNumber: null,
    requireNegative: false,
    requireDecimal: false,
    requireParentheses: false,
  };
}

export type RuleConflictCode =
  | 'REQUIRED_OPERATION_DIVISION_BY_ZERO'
  | 'REQUIRED_OPERATION_NOT_EVALUABLE'
  | 'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL'
  | 'MAX_NUMBER_BLOCKS_REQUIRED_LITERAL'
  | 'ALL_DIGITS_FORBIDDEN'
  | 'NO_WRITABLE_NUMBER'
  | 'NO_WRITABLE_DECIMAL'
  | 'OPERATOR_REQUIRED_AND_FORBIDDEN'
  | 'OPERATOR_NOT_IN_SYNTAX'
  | 'DECIMALS_NOT_IN_SYNTAX'
  | 'PARENTHESES_IMPOSSIBLE'
  | 'REQUIRED_OPERATIONS_EXCEED_MAX_LENGTH'
  | 'MIN_NUMBERS_EXCEED_MAX_LENGTH';

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
  /** Sintaxis del mundo (por defecto la del Mundo 1). */
  syntax?: MathSyntax;
}

const ALL_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

type Entry<T> = { rule: RuleDefinition; config: T };

interface ParsedRules {
  forbidden: Entry<{ digit: number }>[];
  required: Entry<RequiredOperationConfig>[];
  requiredOperators: Entry<{ operator: BinaryOperator }>[];
  forbiddenOperators: Entry<{ operator: BinaryOperator }>[];
  minNumbers: Entry<{ count: number }>[];
  maxNumbers: Entry<{ max: number }>[];
  flags: Entry<null>[];
}

/**
 * Detecta, SIN intentar generar nada, combinaciones de reglas que no admiten ninguna solución.
 *
 * Solo se declara incompatibilidad cuando se puede demostrar a partir de la semántica real de las reglas
 * (y del evaluador):
 *
 *  1. `REQUIRED_OPERATION` con `/ 0` o con una potencia no evaluable (`0 ^ 0`, exponente > 12): el
 *     evaluador recorre todos los nodos, así que toda expresión que contenga ese nodo falla.
 *  2. `FORBIDDEN_DIGIT(d)` + `REQUIRED_OPERATION` con un literal `v`: cualquier texto con valor `v` es
 *     `0…0` + los dígitos canónicos de `v` (+ ceros decimales), así que contiene `d` si `String(v)` lo contiene.
 *  3. `MAX_NUMBER(m)` + `REQUIRED_OPERATION` con un literal `v > m`: la operación exige ese literal.
 *  4. Dígitos/máximo que impiden escribir cualquier literal: los 10 dígitos prohibidos, o el menor dígito
 *     permitido supera el máximo (todo literal vale al menos su primera cifra).
 *  5. `REQUIRED_DECIMAL` sin decimales en la sintaxis, o sin ningún decimal no entero escribible con los
 *     dígitos permitidos y el máximo.
 *  6. Un operador exigido (por `REQUIRED_OPERATOR` o por una `REQUIRED_OPERATION`) que está prohibido, o
 *     `^` exigido en una sintaxis sin potencias.
 *  7. `REQUIRED_PARENTHESES` con todos los operadores binarios prohibidos (sin operación no hay paréntesis
 *     necesarios).
 *  8. Longitud: cada operación exigida distinta necesita su propio nodo con dos literales; `MIN_NUMBERS(n)`
 *     necesita al menos `2n − 1` caracteres.
 *
 * Cualquier otra cosa (p. ej. "no he sabido construir una solución") NO es una incompatibilidad.
 */
export function checkRuleCompatibility(
  rules: readonly RuleDefinition[],
  options: RuleCompatibilityOptions = {},
): RuleCompatibilityResult {
  const ruleEngine = options.ruleEngine ?? createDefaultRuleEngine();
  const maxLength = options.maxExpressionLength ?? DEFAULT_MAX_EXPRESSION_LENGTH;
  const syntax = options.syntax ?? DEFAULT_MATH_SYNTAX;

  const invalid: RuleIssue[] = [];
  const unsupported: RuleIssue[] = [];
  const parsed: ParsedRules = {
    forbidden: [],
    required: [],
    requiredOperators: [],
    forbiddenOperators: [],
    minNumbers: [],
    maxNumbers: [],
    flags: [],
  };

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
    switch (rule.type) {
      case FORBIDDEN_DIGIT:
        parsed.forbidden.push({ rule, config: forbiddenDigitRule.parseConfig(rule.config) });
        break;
      case REQUIRED_OPERATION:
        parsed.required.push({ rule, config: requiredOperationRule.parseConfig(rule.config) });
        break;
      case REQUIRED_OPERATOR:
        parsed.requiredOperators.push({ rule, config: requiredOperatorRule.parseConfig(rule.config) });
        break;
      case FORBIDDEN_OPERATOR:
        parsed.forbiddenOperators.push({ rule, config: forbiddenOperatorRule.parseConfig(rule.config) });
        break;
      case MIN_NUMBERS:
        parsed.minNumbers.push({ rule, config: minNumbersRule.parseConfig(rule.config) });
        break;
      case MAX_NUMBER:
        parsed.maxNumbers.push({ rule, config: maxNumberRule.parseConfig(rule.config) });
        break;
      case REQUIRED_NEGATIVE:
      case REQUIRED_DECIMAL:
      case REQUIRED_PARENTHESES:
        parsed.flags.push({ rule, config: null });
        break;
      default:
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

  const constraints = toConstraints(rules, parsed, syntax);
  const conflicts = findConflicts(parsed, constraints, maxLength);
  if (conflicts.length > 0) return { status: 'INCOMPATIBLE', conflicts };

  return { status: 'NO_CONFLICT_FOUND', constraints };
}

function issue(code: RuleIssueCode, rule: RuleDefinition, message: string): RuleIssue {
  return { code, ruleId: rule.id, ruleType: rule.type, message };
}

function sortedOperators(operators: Iterable<BinaryOperator>): BinaryOperator[] {
  const set = new Set(operators);
  return BINARY_OPERATORS.filter((operator) => set.has(operator));
}

function toConstraints(
  rules: readonly RuleDefinition[],
  parsed: ParsedRules,
  syntax: MathSyntax,
): RuleConstraints {
  const flag = (type: string) => parsed.flags.some(({ rule }) => rule.type === type);
  const maxima = parsed.maxNumbers.map(({ config }) => config.max);
  return {
    rules,
    syntax,
    forbiddenDigits: [...new Set(parsed.forbidden.map(({ config }) => config.digit))].sort((a, b) => a - b),
    requiredOperations: uniqueOperations(parsed.required.map(({ config }) => config)),
    requiredOperators: sortedOperators(parsed.requiredOperators.map(({ config }) => config.operator)),
    forbiddenOperators: sortedOperators(parsed.forbiddenOperators.map(({ config }) => config.operator)),
    minNumbers: Math.max(0, ...parsed.minNumbers.map(({ config }) => config.count)),
    maxNumber: maxima.length === 0 ? null : Math.min(...maxima),
    requireNegative: flag(REQUIRED_NEGATIVE),
    requireDecimal: flag(REQUIRED_DECIMAL),
    requireParentheses: flag(REQUIRED_PARENTHESES),
  };
}

function findConflicts(parsed: ParsedRules, constraints: RuleConstraints, maxLength: number): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  const { forbidden, required, requiredOperators, forbiddenOperators, minNumbers, maxNumbers, flags } =
    parsed;
  const { syntax } = constraints;
  const ids = (entries: ReadonlyArray<Entry<unknown>>) => entries.map(({ rule }) => rule.id);

  for (const { rule, config } of required) {
    if (config.operator === '/' && config.right === 0) {
      conflicts.push({
        code: 'REQUIRED_OPERATION_DIVISION_BY_ZERO',
        message: `La regla "${rule.id}" exige ${config.left} / 0: toda expresión que la contenga divide entre cero.`,
        ruleIds: [rule.id],
      });
    }
    if (config.operator === '^') {
      try {
        evaluatePower(Fraction.of(config.left), Fraction.of(config.right));
      } catch (error) {
        if (!(error instanceof MathError)) throw error;
        conflicts.push({
          code: 'REQUIRED_OPERATION_NOT_EVALUABLE',
          message: `La regla "${rule.id}" exige ${config.left} ^ ${config.right}, que no se puede evaluar: ${error.message}`,
          ruleIds: [rule.id],
        });
      }
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

  for (const m of maxNumbers) {
    for (const r of required) {
      const blocked = [r.config.left, r.config.right].filter((literal) => literal > m.config.max);
      if (blocked.length > 0) {
        conflicts.push({
          code: 'MAX_NUMBER_BLOCKS_REQUIRED_LITERAL',
          message:
            `La regla "${m.rule.id}" no admite números mayores que ${m.config.max}, pero "${r.rule.id}" exige ` +
            `el literal ${blocked[0]}.`,
          ruleIds: [m.rule.id, r.rule.id],
        });
      }
    }
  }

  const allowedDigits = ALL_DIGITS.filter((digit) => !constraints.forbiddenDigits.includes(digit));
  if (allowedDigits.length === 0) {
    conflicts.push({
      code: 'ALL_DIGITS_FORBIDDEN',
      message: 'Están prohibidos los 10 dígitos: no se puede escribir ningún número.',
      ruleIds: ids(forbidden),
    });
  } else if (constraints.maxNumber !== null && allowedDigits[0] > constraints.maxNumber) {
    conflicts.push({
      code: 'NO_WRITABLE_NUMBER',
      message:
        `El menor dígito permitido es ${allowedDigits[0]} y ningún número puede superar ${constraints.maxNumber}: ` +
        'no se puede escribir ningún literal.',
      ruleIds: [...ids(forbidden), ...ids(maxNumbers)],
    });
  }

  const decimalRules = flags.filter(({ rule }) => rule.type === REQUIRED_DECIMAL);
  if (decimalRules.length > 0) {
    if (!syntax.decimals) {
      conflicts.push({
        code: 'DECIMALS_NOT_IN_SYNTAX',
        message: 'Se exige un número decimal, pero la sintaxis del mundo no admite decimales.',
        ruleIds: ids(decimalRules),
      });
    } else if (allowedDigits.length > 0 && !decimalWritable(allowedDigits, constraints.maxNumber)) {
      conflicts.push({
        code: 'NO_WRITABLE_DECIMAL',
        message:
          'Con los dígitos permitidos y el máximo de las reglas no se puede escribir ningún decimal no entero.',
        ruleIds: [...ids(decimalRules), ...ids(forbidden), ...ids(maxNumbers)],
      });
    }
  }

  const forbiddenSet = new Set(constraints.forbiddenOperators);
  const forbiddenRuleOf = (operator: BinaryOperator) =>
    forbiddenOperators.filter(({ config }) => config.operator === operator).map(({ rule }) => rule.id);
  const demands: Array<{ ruleId: string; operator: BinaryOperator; what: string }> = [
    ...requiredOperators.map(({ rule, config }) => ({
      ruleId: rule.id,
      operator: config.operator,
      what: `una ${OPERATOR_NAMES[config.operator]}`,
    })),
    ...required.map(({ rule, config }) => ({
      ruleId: rule.id,
      operator: config.operator,
      what: `${config.left} ${config.operator} ${config.right}`,
    })),
  ];
  for (const { ruleId, operator, what } of demands) {
    if (forbiddenSet.has(operator)) {
      conflicts.push({
        code: 'OPERATOR_REQUIRED_AND_FORBIDDEN',
        message: `La regla "${ruleId}" exige ${what}, pero el operador "${operator}" está prohibido.`,
        ruleIds: [ruleId, ...forbiddenRuleOf(operator)],
      });
    }
    if (operator === '^' && !syntax.powers) {
      conflicts.push({
        code: 'OPERATOR_NOT_IN_SYNTAX',
        message: `La regla "${ruleId}" exige ${what}, pero la sintaxis del mundo no admite potencias.`,
        ruleIds: [ruleId],
      });
    }
  }

  const parenthesesRules = flags.filter(({ rule }) => rule.type === REQUIRED_PARENTHESES);
  const usable = BINARY_OPERATORS.filter((op) => !forbiddenSet.has(op) && (op !== '^' || syntax.powers));
  if (parenthesesRules.length > 0 && usable.length === 0) {
    conflicts.push({
      code: 'PARENTHESES_IMPOSSIBLE',
      message: 'Se exigen paréntesis necesarios, pero todas las operaciones están prohibidas.',
      ruleIds: [...ids(parenthesesRules), ...ids(forbiddenOperators)],
    });
  }

  const distinct = constraints.requiredOperations;
  if (distinct.length > 0) {
    // Mínimo de caracteres: operandos + operador de cada operación + (k - 1) operadores de enlace.
    const minimumLength =
      distinct.reduce((sum, op) => sum + String(op.left).length + 1 + String(op.right).length, 0) +
      (distinct.length - 1);
    if (minimumLength > maxLength) {
      conflicts.push({
        code: 'REQUIRED_OPERATIONS_EXCEED_MAX_LENGTH',
        message: `Las operaciones exigidas necesitan al menos ${minimumLength} caracteres y el máximo es ${maxLength}.`,
        ruleIds: ids(required),
      });
    }
  }

  if (constraints.minNumbers > 0 && 2 * constraints.minNumbers - 1 > maxLength) {
    conflicts.push({
      code: 'MIN_NUMBERS_EXCEED_MAX_LENGTH',
      message: `${constraints.minNumbers} números necesitan al menos ${2 * constraints.minNumbers - 1} caracteres y el máximo es ${maxLength}.`,
      ruleIds: ids(minNumbers),
    });
  }

  return conflicts;
}

/**
 * ¿Existe un literal decimal NO entero con esos dígitos y ≤ max? Con el 0 permitido basta `0.d` (d el menor
 * dígito no nulo permitido, < 1 ≤ max). Sin el 0, la parte entera empieza por un dígito no nulo `a` y el menor
 * literal posible es `a.a`.
 */
function decimalWritable(allowed: readonly number[], max: number | null): boolean {
  const nonZero = allowed.filter((digit) => digit > 0);
  if (nonZero.length === 0) return false;
  if (allowed.includes(0) || max === null) return true;
  const a = nonZero[0];
  return a + a / 10 <= max;
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
