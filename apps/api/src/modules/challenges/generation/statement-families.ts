import { StatementKind } from '../challenge.types';
import { BinaryOperator, Fraction, MathSyntax, minimumOperandPrecedence, operatorPrecedence } from '../math';
import {
  CandidateRejection,
  ChallengeDifficultyProfile,
  StatementFamily,
  TemplateComplexity,
  TemplateId,
} from './generation.types';
import { generateMultiplicativeStatement } from './multiplicative-templates';
import { SeededRandom } from './seeded-random';

export interface FamilyContext {
  rng: SeededRandom;
  profile: ChallengeDifficultyProfile;
  /** Dígitos prohibidos: se favorece que los operandos los contengan para que el enunciado "muerda". */
  biasDigits: readonly number[];
  syntax: MathSyntax;
  /**
   * Evalúa un texto con el parser y el evaluador REALES. Solo lo usa la familia de ecuaciones para calcular
   * el término independiente a partir de la solución elegida; el resultado esperado del reto lo da el solver.
   */
  evaluate: (expression: string) => Fraction;
}

export interface FamilyStatement {
  family: StatementFamily;
  templateId: TemplateId;
  /** Texto del enunciado. El resultado NO se calcula aquí: lo da `MathEvaluator` o `solveLinearEquation`. */
  expression: string;
  kind: StatementKind;
}

/** Árbol de plantilla: lo que se escribe, nunca su valor. */
type Tpl =
  | { k: 'lit'; text: string }
  | { k: 'var' }
  | { k: 'neg'; operand: Tpl }
  | { k: 'bin'; op: BinaryOperator; left: Tpl; right: Tpl; paren?: boolean };

const BIAS_DRAWS = 6;
/** Mayor |valor| que se acepta en enunciados con potencias o ecuaciones (resultados "humanos"). */
const MAX_RESULT_MAGNITUDE = Fraction.of(1_000_000);
const MAX_RESULT_DENOMINATOR = 1000n;

/** Familias que pueden escribirse en una sintaxis. */
export function familyFitsSyntax(family: StatementFamily, syntax: MathSyntax): boolean {
  if (family === 'DECIMAL') return syntax.decimals;
  if (family === 'POWER') return syntax.powers;
  return true;
}

/**
 * Escribe un enunciado de la familia indicada. Es una función pura del RNG: el mismo estado produce el
 * mismo enunciado. Devuelve `null` si con este perfil no se pudo instanciar la plantilla elegida.
 */
export function generateFamilyStatement(
  family: StatementFamily,
  context: FamilyContext,
): FamilyStatement | null {
  switch (family) {
    case 'MULTIPLICATIVE': {
      const statement = generateMultiplicativeStatement(context);
      return {
        family,
        templateId: statement.templateId,
        expression: statement.expression,
        kind: 'EXPRESSION',
      };
    }
    case 'SIGNED':
      return expression(family, context, SIGNED);
    case 'FRACTIONAL':
      return expression(family, context, FRACTIONAL);
    case 'DECIMAL':
      return expression(family, context, DECIMAL);
    case 'POWER':
      return expression(family, context, POWER);
    case 'LINEAR_EQUATION':
      return linearEquation(context);
  }
}

/**
 * Criterio de aceptación del VALOR (resultado o solución) según la familia y el perfil.
 * La familia multiplicativa conserva exactamente su criterio original.
 */
export function familyRejection(
  family: StatementFamily,
  value: Fraction,
  profile: ChallengeDifficultyProfile,
): CandidateRejection | null {
  if (profile.maxResult !== undefined && value.abs().compare(Fraction.of(profile.maxResult)) > 0) {
    return 'UNSUITABLE_RESULT';
  }
  if (family === 'MULTIPLICATIVE') {
    if (value.numerator <= 0n) return 'NON_POSITIVE_RESULT';
    if (!profile.allowFractions && !value.isInteger()) return 'FRACTIONAL_RESULT';
    return null;
  }
  if (value.isZero()) return 'UNSUITABLE_RESULT';
  if (value.abs().compare(MAX_RESULT_MAGNITUDE) > 0 || value.denominator > MAX_RESULT_DENOMINATOR) {
    return 'UNSUITABLE_RESULT';
  }
  switch (family) {
    case 'SIGNED':
      return !profile.allowFractions && !value.isInteger() ? 'FRACTIONAL_RESULT' : null;
    case 'FRACTIONAL':
    case 'DECIMAL':
      return !profile.allowNegative && value.isNegative() ? 'NON_POSITIVE_RESULT' : null;
    case 'POWER':
    case 'LINEAR_EQUATION':
      if (!profile.allowNegative && value.isNegative()) return 'NON_POSITIVE_RESULT';
      return !profile.allowFractions && !value.isInteger() ? 'FRACTIONAL_RESULT' : null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Familias de expresiones
// ---------------------------------------------------------------------------------------------------------

type Builder = (context: FamilyContext, count: number) => Tpl | null;
type FamilyTemplates = Partial<Record<TemplateId, { from: TemplateComplexity; build: Builder }>>;

const COMPLEXITY_RANK: Record<TemplateComplexity, number> = { PRODUCT: 0, MIXED: 1, NESTED: 2 };

function expression(
  family: StatementFamily,
  context: FamilyContext,
  templates: FamilyTemplates,
): FamilyStatement | null {
  const { rng, profile } = context;
  const count = rng.nextInt(profile.operandCount.min, profile.operandCount.max);
  const available = (Object.keys(templates) as TemplateId[]).filter(
    (id) => COMPLEXITY_RANK[templates[id]!.from] <= COMPLEXITY_RANK[profile.complexity],
  );
  const templateId = rng.pick(available);
  const tree = templates[templateId]!.build(context, count);
  return tree === null ? null : { family, templateId, expression: render(tree), kind: 'EXPRESSION' };
}

const SIGNED: FamilyTemplates = {
  /** `-7 + 3 - (-5)` */
  SIGNED_SUM: {
    from: 'PRODUCT',
    build: (context, count) => {
      const terms = Array.from({ length: count }, () => signedLiteral(context, 0.5));
      return terms.reduce((acc, term) => bin(context.rng.chance(0.5) ? '+' : '-', acc, term));
    },
  },
  /** `-3 * 4 * (-2)` */
  SIGNED_PRODUCT: {
    from: 'PRODUCT',
    build: (context, count) => {
      const factors = Array.from({ length: Math.min(count, 3) }, () => signedLiteral(context, 0.5));
      return factors.reduce((acc, factor) => bin('*', acc, factor));
    },
  },
  /** `4 - 9`, `3 * 2 - 5 * 4`, `12 - 3 * 7` (sin números negativos escritos) */
  SIGNED_DIFFERENCE: {
    from: 'MIXED',
    build: (context, count) => {
      const { rng } = context;
      if (count >= 3) {
        const product = bin('*', literal(context), literal(context));
        const rest = count >= 4 ? bin('*', literal(context), literal(context)) : literal(context);
        return rng.chance(0.5) ? bin('-', product, rest) : bin('-', rest, product);
      }
      return bin('-', literal(context), literal(context));
    },
  },
  /** `(4 - 9) * 3`, `-(2 + 5) * 3`, `(3 - 8) * (2 - 6)`, `5 - (2 - 9)` */
  SIGNED_NESTED: {
    from: 'NESTED',
    build: (context, count) => {
      const { rng } = context;
      const group = () => bin(rng.chance(0.7) ? '-' : '+', literal(context), literal(context));
      switch (rng.nextInt(0, count >= 4 ? 3 : 2)) {
        case 0:
          return bin('*', group(), signedLiteral(context, 0.3));
        case 1:
          return bin('*', neg(group()), literal(context));
        case 2:
          return bin('-', literal(context), group());
        default:
          return bin('*', group(), group());
      }
    },
  },
};

const FRACTIONAL: FamilyTemplates = {
  /** `1 / 2 + 3 / 4`, `5 / 6 - 1 / 3 + 1 / 2` */
  FRACTION_SUM: {
    from: 'PRODUCT',
    build: (context, count) => {
      const terms = Array.from({ length: Math.min(Math.max(count, 2), 3) }, () => fraction(context));
      return terms.reduce((acc, term) => bin(context.rng.chance(0.65) ? '+' : '-', acc, term));
    },
  },
  /** `3 / 4 * 8`, `2 / 3 * 5` */
  FRACTION_OF_INTEGER: {
    from: 'PRODUCT',
    build: (context) => {
      const { rng } = context;
      const d = denominator(context);
      const n = rng.nextInt(1, Math.max(1, d - 1));
      const factor = rng.chance(0.6)
        ? d * rng.nextInt(1, 4)
        : integer(context, 2, Math.max(2, context.profile.operandRange.max));
      return bin('*', bin('/', lit(n), lit(d)), lit(factor));
    },
  },
  /** `(2 / 3) * (3 / 4)` */
  FRACTION_PRODUCT: {
    from: 'MIXED',
    build: (context) =>
      bin('*', { ...fraction(context), paren: true } as Tpl, { ...fraction(context), paren: true } as Tpl),
  },
  /** `2 + 3 / 4` */
  MIXED_NUMBER: {
    from: 'MIXED',
    build: (context) => {
      const d = denominator(context);
      const n = context.rng.nextInt(1, Math.max(1, d - 1));
      return bin(context.rng.chance(0.7) ? '+' : '-', literal(context), bin('/', lit(n), lit(d)));
    },
  },
  /** `(1 / 2 + 1 / 3) * 6`, `(5 + 7) / 8` */
  FRACTION_NESTED: {
    from: 'NESTED',
    build: (context) => {
      const { rng } = context;
      if (rng.chance(0.5))
        return bin(
          '*',
          bin(rng.chance(0.7) ? '+' : '-', fraction(context), fraction(context)),
          literal(context),
        );
      return bin('/', bin('+', literal(context), literal(context)), lit(denominator(context)));
    },
  },
};

const DECIMAL: FamilyTemplates = {
  /** `2.5 + 1.75`, `3.2 - 1.5`, `0.4 + 1.6` */
  DECIMAL_SUM: {
    from: 'PRODUCT',
    build: (context, count) => {
      const { rng } = context;
      const k = Math.min(Math.max(count, 2), 3);
      if (k === 2 && rng.chance(0.45)) {
        const [a, b] = complementaryDecimals(context);
        return bin('+', lit(a), lit(b));
      }
      const terms = Array.from({ length: k }, () => decimalLiteral(context));
      const operator = (): BinaryOperator => (context.profile.allowNegative || rng.chance(0.7) ? '+' : '-');
      return terms.reduce((acc, term) => bin(operator(), acc, term));
    },
  },
  /** `2.5 * 4`, `0.5 * 3.2`, `1.25 * 8` */
  DECIMAL_PRODUCT: {
    from: 'PRODUCT',
    build: (context) => {
      const { rng } = context;
      if (rng.chance(0.55)) {
        const [text, multipleOf] = rng.pick([
          ['.5', 2],
          ['.25', 4],
          ['.75', 4],
          ['.2', 5],
          ['.4', 5],
          ['.8', 5],
        ] as const);
        const whole = rng.nextInt(0, Math.min(9, context.profile.operandRange.max));
        const factor = multipleOf * rng.nextInt(1, multipleOf === 2 ? 6 : 2);
        return bin('*', lit(`${whole}${text}`), lit(factor));
      }
      const right = rng.chance(0.3)
        ? decimalLiteral(context)
        : lit(integer(context, 2, Math.min(12, Math.max(2, context.profile.operandRange.max))));
      return bin('*', decimalLiteral(context), right);
    },
  },
  /** `7.5 / 2.5`, `4.5 / 3` (divisiones exactas) */
  DECIMAL_QUOTIENT: {
    from: 'MIXED',
    build: (context) => {
      const { rng } = context;
      const quotient = rng.chance(0.5) ? Fraction.of(rng.nextInt(2, 9)) : Fraction.of(rng.nextInt(3, 49), 10);
      const decimalDivisor = Fraction.of(rng.nextInt(1, 9) * 10 + 5, 10); // 1.5, 2.5, …, 9.5
      let divisor = rng.chance(0.5) ? Fraction.of(rng.nextInt(2, 9)) : decimalDivisor;
      // La familia es "decimal": al menos uno de los dos literales debe serlo (nunca `16 / 8`).
      if (quotient.multiply(divisor).isInteger() && divisor.isInteger()) divisor = decimalDivisor;
      const dividend = quotient.multiply(divisor).toTerminatingDecimal();
      const divisorText = divisor.toTerminatingDecimal();
      if (dividend === null || divisorText === null) return null;
      return bin('/', lit(dividend), lit(divisorText));
    },
  },
  /** `(1.5 + 2.5) * 3`, `2.5 * 4 - 1.5` */
  DECIMAL_NESTED: {
    from: 'NESTED',
    build: (context) => {
      const { rng } = context;
      const factor = lit(integer(context, 2, 9));
      if (rng.chance(0.5))
        return bin('*', bin('+', decimalLiteral(context), decimalLiteral(context)), factor);
      return bin(
        rng.chance(0.6) ? '-' : '+',
        bin('*', decimalLiteral(context), factor),
        decimalLiteral(context),
      );
    },
  },
};

const POWER: FamilyTemplates = {
  /** `2 ^ 3 + 5`, `3 ^ 2 - 4`, `2 ^ 4 + 3 ^ 2` */
  POWER_SUM: {
    from: 'PRODUCT',
    build: (context, count) => {
      const { rng } = context;
      const operator: BinaryOperator = rng.chance(0.6) ? '+' : '-';
      const second = count >= 3 && rng.chance(0.5) ? power(context) : literal(context);
      return bin(operator, power(context), second);
    },
  },
  /** `3 * 2 ^ 4`, `2 ^ 6 / 4`, `2 ^ 3 * 3 ^ 2` */
  POWER_PRODUCT: {
    from: 'PRODUCT',
    build: (context, count) => {
      const { rng } = context;
      const choice = rng.nextInt(0, count >= 3 ? 2 : 1);
      if (choice === 0) return bin('*', literal(context, 9), power(context));
      if (choice === 1) {
        const base = rng.nextInt(2, 6);
        const exponent = rng.nextInt(3, base <= 3 ? 5 : 3);
        const divisor = base ** rng.nextInt(1, exponent - 1);
        return bin('/', bin('^', lit(base), lit(exponent)), lit(divisor));
      }
      return bin('*', power(context, 2), power(context, 2));
    },
  },
  /** `(2 + 3) ^ 2`, `(-2) ^ 3`, `(2 ^ 3 - 5) * 4` */
  POWER_NESTED: {
    from: 'NESTED',
    build: (context) => {
      const { rng } = context;
      switch (rng.nextInt(0, 2)) {
        case 0:
          return bin(
            '^',
            bin(rng.chance(0.7) ? '+' : '-', literal(context, 6), literal(context, 6)),
            lit(rng.chance(0.75) ? 2 : 3),
          );
        case 1:
          return bin(
            rng.chance(0.5) ? '+' : '*',
            bin('^', neg(lit(integer(context, 2, 5))), lit(rng.nextInt(2, 3))),
            literal(context),
          );
        default:
          return bin(
            '*',
            bin(rng.chance(0.5) ? '-' : '+', power(context), literal(context)),
            literal(context, 9),
          );
      }
    },
  },
};

// ---------------------------------------------------------------------------------------------------------
// Ecuaciones lineales
// ---------------------------------------------------------------------------------------------------------

const EQUATIONS: Array<{ id: TemplateId; from: TemplateComplexity }> = [
  { id: 'EQ_AX', from: 'PRODUCT' },
  { id: 'EQ_AX_B', from: 'PRODUCT' },
  { id: 'EQ_X_OVER_A', from: 'MIXED' },
  { id: 'EQ_A_PAREN', from: 'MIXED' },
  { id: 'EQ_BOTH_SIDES', from: 'NESTED' },
  { id: 'EQ_PAREN_PLUS', from: 'NESTED' },
];

/**
 * `a * x + b = c`, `x / a + b = c`, `a * (x - b) = c`, `a * x + b = d * x + e`…
 * Se elige primero la solución `s` y los coeficientes; el término independiente se calcula evaluando el lado
 * con `x := s`. El resultado esperado del reto NO es `s`: lo calcula después el solver exacto.
 */
function linearEquation(context: FamilyContext): FamilyStatement | null {
  const { rng, profile } = context;
  const available = EQUATIONS.filter((e) => COMPLEXITY_RANK[e.from] <= COMPLEXITY_RANK[profile.complexity]);
  const templateId = rng.pick(available).id;
  const top = Math.max(3, profile.operandRange.max);
  const coefficient = () => integer(context, 2, Math.min(9, Math.max(2, top)));
  const constant = () => integer(context, 1, top);
  const sign = (): BinaryOperator => (rng.chance(0.6) ? '+' : '-');

  let solution = solutionValue(context, top);
  const x: Tpl = { k: 'var' };
  let left: Tpl;
  let rightVar: Tpl | null = null;

  switch (templateId) {
    case 'EQ_AX':
      left = bin('*', lit(coefficient()), x);
      break;
    case 'EQ_AX_B':
      left = rng.chance(0.2)
        ? bin(sign(), x, lit(constant()))
        : bin(sign(), bin('*', lit(coefficient()), x), lit(constant()));
      break;
    case 'EQ_X_OVER_A': {
      const a = coefficient();
      // La solución es un múltiplo entero de `a` para que el lado derecho sea entero.
      solution = Fraction.of(a * rng.nextInt(1, Math.max(1, Math.floor(top / a) + 1)));
      if (profile.allowNegative && rng.chance(0.3)) solution = solution.negate();
      left = bin(sign(), bin('/', x, lit(a)), lit(constant()));
      break;
    }
    case 'EQ_A_PAREN':
      left = bin('*', lit(coefficient()), bin(sign(), x, lit(constant())));
      break;
    case 'EQ_BOTH_SIDES': {
      const a = coefficient();
      let d = coefficient();
      if (d === a) d = a === 2 ? 3 : a - 1;
      left = bin(sign(), bin('*', lit(a), x), lit(constant()));
      rightVar = bin('*', lit(d), x);
      break;
    }
    case 'EQ_PAREN_PLUS':
      left = bin(sign(), bin('*', lit(coefficient()), bin(sign(), x, lit(constant()))), lit(constant()));
      break;
    default:
      return null;
  }

  // Término independiente: valor de (izquierda − parte con x de la derecha) en x = s, con el evaluador real.
  const substituted = rightVar === null ? left : bin('-', left, rightVar);
  let constantValue: Fraction;
  try {
    constantValue = context.evaluate(render(substitute(substituted, valueTpl(solution, context.syntax))));
  } catch {
    return null;
  }
  const constantTpl = valueTpl(constantValue, context.syntax);
  let right: Tpl;
  if (rightVar === null) {
    right = constantTpl;
  } else if (constantValue.isZero()) {
    right = rightVar;
  } else {
    right = constantValue.isNegative()
      ? bin('-', rightVar, valueTpl(constantValue.negate(), context.syntax))
      : bin('+', rightVar, constantTpl);
  }
  return {
    family: 'LINEAR_EQUATION',
    templateId,
    expression: `${render(left)} = ${render(right)}`,
    kind: 'EQUATION',
  };
}

function solutionValue(context: FamilyContext, top: number): Fraction {
  const { rng, profile, syntax } = context;
  let value = Fraction.of(integer(context, 1, Math.max(2, top)));
  if (profile.allowFractions && syntax.decimals && rng.chance(0.3)) value = value.add(Fraction.of(1, 2));
  if (profile.allowNegative && rng.chance(0.35)) value = value.negate();
  return value;
}

/** Un valor exacto como plantilla: `7`, `-7`, `2.5` (con decimales) o `7 / 2`. */
function valueTpl(value: Fraction, syntax: MathSyntax): Tpl {
  if (value.isNegative()) return neg(valueTpl(value.negate(), syntax));
  if (value.isInteger()) return lit(value.numerator.toString());
  const decimal = syntax.decimals ? value.toTerminatingDecimal() : null;
  if (decimal !== null) return lit(decimal);
  return bin('/', lit(value.numerator.toString()), lit(value.denominator.toString()));
}

function substitute(node: Tpl, replacement: Tpl): Tpl {
  switch (node.k) {
    case 'var':
      return replacement;
    case 'lit':
      return node;
    case 'neg':
      return neg(substitute(node.operand, replacement));
    case 'bin':
      return {
        ...node,
        left: substitute(node.left, replacement),
        right: substitute(node.right, replacement),
      };
  }
}

// ---------------------------------------------------------------------------------------------------------
// Operandos
// ---------------------------------------------------------------------------------------------------------

function containsAnyDigit(text: string, digits: readonly number[]): boolean {
  return digits.some((digit) => text.includes(String(digit)));
}

/** Entero en [min, max] con sesgo (50 %) hacia los que contienen un dígito prohibido. */
function integer(context: FamilyContext, min: number, max: number): number {
  const { rng, biasDigits } = context;
  const high = Math.max(min, max);
  let value = rng.nextInt(min, high);
  if (biasDigits.length > 0 && rng.chance(0.5)) {
    for (let draw = 0; draw < BIAS_DRAWS && !containsAnyDigit(String(value), biasDigits); draw++) {
      value = rng.nextInt(min, high);
    }
  }
  return value;
}

/** Operando del rango del perfil (opcionalmente acotado por arriba). */
function literal(context: FamilyContext, cap?: number): Tpl {
  const { min, max } = context.profile.operandRange;
  const high = cap === undefined ? max : Math.max(min, Math.min(max, cap));
  return lit(integer(context, min, high));
}

function signedLiteral(context: FamilyContext, negativeChance: number): Tpl {
  const value = literal(context);
  return context.rng.chance(negativeChance) ? neg(value) : value;
}

function denominator(context: FamilyContext): number {
  return integer(context, 2, Math.min(12, Math.max(2, context.profile.operandRange.max)));
}

/** `n / d` con 1 ≤ n ≤ rango y d ∈ [2, 12]; a veces propia (n < d). */
function fraction(context: FamilyContext): Tpl {
  const d = denominator(context);
  const top = context.rng.chance(0.6) ? Math.max(1, d - 1) : Math.max(1, context.profile.operandRange.max);
  return bin('/', lit(integer(context, 1, top)), lit(d));
}

/** Decimal no entero con 1 o 2 cifras decimales y parte entera en [0, rango]. */
function decimalLiteral(context: FamilyContext): Tpl {
  const { rng, biasDigits } = context;
  const draw = () => {
    const whole = rng.nextInt(0, Math.min(99, context.profile.operandRange.max));
    const places = rng.chance(0.3) ? 2 : 1;
    let digits = '';
    for (let i = 0; i < places; i++)
      digits += String(i === places - 1 ? rng.nextInt(1, 9) : rng.nextInt(0, 9));
    return `${whole}.${digits}`;
  };
  let text = draw();
  if (biasDigits.length > 0 && rng.chance(0.5)) {
    for (let i = 0; i < BIAS_DRAWS && !containsAnyDigit(text, biasDigits); i++) text = draw();
  }
  return lit(text);
}

/** Dos decimales cuya suma es entera: `1.25` y `2.75`. */
function complementaryDecimals(context: FamilyContext): [string, string] {
  const { rng } = context;
  const places = rng.chance(0.3) ? 2 : 1;
  const scale = 10 ** places;
  let part = rng.nextInt(1, scale - 1);
  if (places === 2 && part % 10 === 0) part += 1;
  const max = Math.min(20, context.profile.operandRange.max);
  const pad = (n: number) => String(n).padStart(places, '0');
  const a = `${rng.nextInt(0, max)}.${pad(part)}`;
  const b = `${rng.nextInt(0, max)}.${pad(scale - part)}`;
  return [a, b];
}

/** `b ^ e` con base 2–9 (acotada por el rango) y exponente 2–3 (4–5 en bases pequeñas). */
function power(context: FamilyContext, maxExponent = 4): Tpl {
  const { rng, profile } = context;
  const base = integer(context, 2, Math.min(9, Math.max(2, profile.operandRange.max)));
  const top = base <= 3 ? maxExponent + 1 : base <= 5 ? 3 : 2;
  return bin('^', lit(base), lit(rng.nextInt(2, Math.max(2, Math.min(top, maxExponent + 1)))));
}

// ---------------------------------------------------------------------------------------------------------
// Construcción y escritura con paréntesis mínimos
// ---------------------------------------------------------------------------------------------------------

function lit(value: number | string): Tpl {
  return { k: 'lit', text: String(value) };
}

function neg(operand: Tpl): Tpl {
  return { k: 'neg', operand };
}

function bin(op: BinaryOperator, left: Tpl, right: Tpl): Tpl {
  return { k: 'bin', op, left, right };
}

function precedence(node: Tpl): number {
  switch (node.k) {
    case 'lit':
    case 'var':
      return 5;
    case 'neg':
      return 3;
    case 'bin':
      return operatorPrecedence(node.op);
  }
}

/**
 * Texto con los paréntesis que exige la gramática (más los marcados con `paren` por legibilidad).
 * Un número negativo que no está al principio va entre paréntesis: `5 - (-3)`, `2 * (-4)`.
 */
function render(node: Tpl, first = true): string {
  switch (node.k) {
    case 'lit':
      return node.text;
    case 'var':
      return 'x';
    case 'neg': {
      const text = `-${operand(node.operand, minimumOperandPrecedence('negation'), false)}`;
      return first ? text : `(${text})`;
    }
    case 'bin':
      return `${operand(node.left, minimumOperandPrecedence(node.op, 'left'), first)} ${node.op} ${operand(
        node.right,
        minimumOperandPrecedence(node.op, 'right'),
        false,
      )}`;
  }
}

function operand(node: Tpl, minimum: number, first: boolean): string {
  const explicit = node.k === 'bin' && node.paren === true;
  return precedence(node) < minimum || explicit ? `(${render(node, true)})` : render(node, first);
}
