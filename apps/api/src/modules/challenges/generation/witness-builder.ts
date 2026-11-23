import {
  BINARY_OPERATORS,
  BinaryOperator,
  DEFAULT_MATH_SYNTAX,
  DEFAULT_MAX_EXPRESSION_LENGTH,
  ExpressionNode,
  ExpressionParser,
  ExpressionSyntaxError,
  Fraction,
  MathError,
  MathEvaluator,
  MathSyntax,
  evaluatePower,
  minimumOperandPrecedence,
  operatorPrecedence,
} from '../math';
import { RuleDefinition, RuleEngine } from '../rules';
import { RuleConstraints } from './rule-compatibility';
import { SeededRandom } from './seeded-random';

export interface WitnessBuilderDependencies {
  parser: ExpressionParser;
  evaluator: MathEvaluator;
  ruleEngine: RuleEngine;
}

export type WitnessRejectionReason =
  'TOO_LONG' | 'SYNTAX_ERROR' | 'EVALUATION_ERROR' | 'VALUE_MISMATCH' | 'RULE_VIOLATION';

export type WitnessVerification =
  | { valid: true; expression: ExpressionNode; value: Fraction }
  | { valid: false; reason: WitnessRejectionReason; message: string };

export interface WitnessBuildInput {
  /** Valor que debe tener la solución. */
  target: Fraction;
  constraints: RuleConstraints;
  rng: SeededRandom;
  /** Longitud máxima del texto (por defecto, la del parser). */
  maxLength?: number;
}

export type WitnessBuildResult =
  | { ok: true; expression: string; strategy: WitnessStrategy }
  /** El constructor (que es incompleto a propósito) no encontró solución: NO prueba incompatibilidad. */
  | { ok: false; reason: 'NO_WITNESS_FOUND' };

/**
 *  - DIRECT: solo hay que escribir el número (con dígitos/operaciones permitidos).
 *  - MULTIPLICATIVE: piezas exigidas multiplicadas por el cociente que falta: `(7 * 1) * 6`.
 *  - ADDITIVE: piezas exigidas sumadas al resto que falta: `(7 * 1) + 14`, `-3 + 2 ^ 3 + 16`.
 */
export type WitnessStrategy = 'DIRECT' | 'MULTIPLICATIVE' | 'ADDITIVE';

/** Un trozo de texto con su precedencia (para poner solo los paréntesis necesarios) y su valor exacto. */
interface Piece {
  text: string;
  /** 1 `+ -` · 2 `* /` · 3 menos unario · 4 `^` · 5 literal o paréntesis. */
  prec: number;
  value: Fraction;
  /** Literales que contiene (para `MIN_NUMBERS`). */
  literals: number;
}

/** Pasos máximos del escritor de números por intento (acota la recursión y los bucles). */
const MAX_WRITER_STEPS = 400;
const MAX_WRITER_DEPTH = 10;
/** Búsqueda de factores: solo para n ≤ 10^12 y como mucho hasta 5000. */
const FACTOR_MAX_N = 1_000_000_000_000n;
const FACTOR_SCAN_LIMIT = 5000;
const FACTOR_PAIRS_LIMIT = 8;
/** Variantes (elecciones de piezas y estrategia) que se prueban por llamada a `build`. */
const COMPOSE_ROUNDS = 4;

const ALL_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const ONE = Fraction.of(1);

/** Decimales no enteros "amables" que el constructor prueba para REQUIRED_DECIMAL. */
const DECIMAL_CANDIDATES = [
  '0.5',
  '1.5',
  '2.5',
  '0.25',
  '0.75',
  '0.2',
  '0.4',
  '0.6',
  '0.8',
  '1.2',
  '1.4',
  '1.6',
  '1.8',
  '2.4',
  '3.5',
  '4.5',
  '0.3',
  '0.7',
  '0.9',
  '1.1',
  '1.3',
  '1.7',
  '1.9',
  '2.2',
  '2.6',
  '2.8',
  '3.4',
  '3.6',
  '3.8',
  '4.4',
  '6.4',
  '6.6',
  '6.8',
  '7.4',
  '8.8',
  '9.9',
  '3.3',
  '4.8',
  '6.2',
  '7.2',
  '8.4',
  '9.6',
  '0.1',
  '0.15',
  '1.25',
];

/**
 * Construye de forma CONSTRUCTIVA (sin búsqueda exhaustiva) una solución de referencia para un valor
 * objetivo que cumpla todas las reglas soportadas, en la sintaxis del mundo:
 *
 *  - Cada operación exigida (`REQUIRED_OPERATION`) se escribe entre paréntesis, `(7 * 1)`, para esquivar la
 *    limitación conocida de esa regla (`2 * 7 * 1` es `(2 * 7) * 1` y no contiene `7 * 1`).
 *  - Cada regla "positiva" aporta una pieza pequeña que la cumple: `a ^ b` (potencia), `-a` (negativo),
 *    `0.5` o `0.2 + 0.8` (decimal), `(a + b) * c` o `-(a + b)` (paréntesis necesarios), `a / b`, `a - b`…
 *  - El resto del valor se escribe con un escritor de números que solo usa dígitos permitidos, literales
 *    ≤ `MAX_NUMBER` y operadores no prohibidos (literal, producto, `q * m + r`, suma o resta con el literal
 *    permitido más cercano, cociente, decimal exacto).
 *  - Las piezas se combinan de forma aditiva o multiplicativa; si faltan números (`MIN_NUMBERS`) el resto
 *    se reparte en más sumandos (`3 + 4 + 14`).
 *
 * Es deliberadamente incompleto: si no encuentra solución devuelve `NO_WITNESS_FOUND`. Cada candidato
 * se valida con el parser, el evaluador y el `RuleEngine` reales antes de devolverse; nada se da por válido.
 */
export class WitnessBuilder {
  constructor(private readonly deps: WitnessBuilderDependencies) {}

  /** Comprueba un texto con las herramientas reales: parser, evaluador y reglas. */
  verify(
    source: string,
    target: Fraction,
    rules: readonly RuleDefinition[],
    maxLength: number = DEFAULT_MAX_EXPRESSION_LENGTH,
    syntax: MathSyntax = DEFAULT_MATH_SYNTAX,
  ): WitnessVerification {
    const { parser, evaluator, ruleEngine } = this.deps;

    if (source.length > maxLength) {
      return rejected('TOO_LONG', `La solución mide ${source.length} caracteres (máximo ${maxLength}).`);
    }

    let expression: ExpressionNode;
    try {
      expression = parser.parseExpression(source, syntax);
    } catch (error) {
      if (error instanceof ExpressionSyntaxError) return rejected('SYNTAX_ERROR', error.message);
      throw error;
    }

    let value: Fraction;
    try {
      value = evaluator.evaluate(expression);
    } catch (error) {
      if (error instanceof MathError) return rejected('EVALUATION_ERROR', error.message);
      throw error;
    }

    if (!value.equals(target)) {
      return rejected('VALUE_MISMATCH', `La solución vale ${value}, no ${target}.`);
    }

    const violations = ruleEngine.validate(rules, { expression });
    if (violations.length > 0) {
      return rejected('RULE_VIOLATION', violations.map((v) => v.message).join(' '));
    }
    return { valid: true, expression, value };
  }

  build({
    target,
    constraints,
    rng,
    maxLength = DEFAULT_MAX_EXPRESSION_LENGTH,
  }: WitnessBuildInput): WitnessBuildResult {
    const allowedDigits = ALL_DIGITS.filter((digit) => !constraints.forbiddenDigits.includes(digit));
    if (allowedDigits.length === 0) return NO_WITNESS;
    const syntax = constraints.syntax ?? DEFAULT_MATH_SYNTAX;
    const verify = (source: string) =>
      this.verify(source, target, constraints.rules, maxLength, syntax).valid;

    const required = this.requiredOperationPieces(constraints);
    if (required === null) return NO_WITNESS;
    const needsGadgets =
      required.length > 0 ||
      constraints.requiredOperators.length > 0 ||
      constraints.requireNegative ||
      constraints.requireDecimal ||
      constraints.requireParentheses;

    for (let round = 0; round < COMPOSE_ROUNDS; round++) {
      const writer = new NumberWriter(constraints, allowedDigits, rng);

      if (!needsGadgets) {
        const direct = writer.withLiterals(target, constraints.minNumbers);
        if (direct !== null && verify(direct.text))
          return { ok: true, expression: direct.text, strategy: 'DIRECT' };
        continue;
      }

      const gadgets = this.gadgets(constraints, writer, rng, required, target);
      if (gadgets === null) continue;

      const strategies: WitnessStrategy[] = rng.shuffle(['MULTIPLICATIVE', 'ADDITIVE'] as const);
      for (const strategy of strategies) {
        const piece =
          strategy === 'ADDITIVE'
            ? additive(gadgets, target, writer, rng, constraints.minNumbers)
            : multiplicative(gadgets, target, writer, constraints.minNumbers);
        if (piece !== null && verify(piece.text)) return { ok: true, expression: piece.text, strategy };
      }
    }
    return NO_WITNESS;
  }

  /** `(l op r)` por cada operación exigida, con su valor evaluado; `null` si alguna no es evaluable. */
  private requiredOperationPieces(constraints: RuleConstraints): Piece[] | null {
    const { parser, evaluator } = this.deps;
    const pieces: Piece[] = [];
    for (const { operator, left, right } of constraints.requiredOperations) {
      const text = `(${left} ${operator} ${right})`;
      try {
        const value = evaluator.evaluate(parser.parseExpression(text, constraints.syntax));
        pieces.push({ text, prec: 5, value, literals: 2 });
      } catch (error) {
        if (error instanceof MathError) return null;
        throw error;
      }
    }
    return pieces;
  }

  /** Una pieza por cada requisito positivo que aún no cubren las operaciones exigidas. */
  private gadgets(
    constraints: RuleConstraints,
    writer: NumberWriter,
    rng: SeededRandom,
    required: readonly Piece[],
    target: Fraction,
  ): Piece[] | null {
    const pieces: Piece[] = [...required];
    const covered = new Set(constraints.requiredOperations.map((op) => op.operator));
    for (const operator of constraints.requiredOperators) {
      if (covered.has(operator)) continue;
      const gadget = writer.operatorGadget(operator, target);
      if (gadget === null) return null;
      pieces.push(gadget);
    }
    if (constraints.requireDecimal) {
      const gadget = writer.decimalGadget();
      if (gadget === null) return null;
      pieces.push(gadget);
    }
    if (constraints.requireParentheses) {
      const gadget = writer.parenthesesGadget();
      if (gadget === null) return null;
      pieces.push(gadget);
    }
    const shuffled = rng.shuffle(pieces);
    if (constraints.requireNegative) {
      const gadget = writer.negativeGadget();
      if (gadget === null) return null;
      shuffled.unshift(gadget); // "-3 + …" se lee mejor al principio
    }
    return shuffled;
  }
}

const NO_WITNESS: WitnessBuildResult = { ok: false, reason: 'NO_WITNESS_FOUND' };

function rejected(reason: WitnessRejectionReason, message: string): WitnessVerification {
  return { valid: false, reason, message };
}

// ---------------------------------------------------------------------------------------------------------
// Piezas de texto con paréntesis mínimos
// ---------------------------------------------------------------------------------------------------------

function atom(text: string, value: Fraction): Piece {
  return { text, prec: 5, value, literals: 1 };
}

function wrap(piece: Piece, minimum: number): string {
  return piece.prec < minimum ? `(${piece.text})` : piece.text;
}

/**
 * `left op right` con los paréntesis que exige la gramática. Por legibilidad, un operando derecho que
 * empieza por "-" va entre paréntesis (`5 + (-3)`); esos paréntesis no cambian el árbol.
 */
function binary(operator: BinaryOperator, left: Piece, right: Piece): Piece | null {
  let value: Fraction;
  try {
    value = applyOperator(operator, left.value, right.value);
  } catch (error) {
    if (error instanceof MathError) return null;
    throw error;
  }
  const leftText = wrap(left, minimumOperandPrecedence(operator, 'left'));
  let rightText = wrap(right, minimumOperandPrecedence(operator, 'right'));
  if (rightText.startsWith('-')) rightText = `(${rightText})`;
  return {
    text: `${leftText} ${operator} ${rightText}`,
    prec: operatorPrecedence(operator),
    value,
    literals: left.literals + right.literals,
  };
}

function negate(piece: Piece): Piece {
  const inner = wrap(piece, 3);
  return {
    text: inner.startsWith('-') ? `-(${inner})` : `-${inner}`,
    prec: 3,
    value: piece.value.negate(),
    literals: piece.literals,
  };
}

function applyOperator(operator: BinaryOperator, a: Fraction, b: Fraction): Fraction {
  switch (operator) {
    case '+':
      return a.add(b);
    case '-':
      return a.subtract(b);
    case '*':
      return a.multiply(b);
    case '/':
      return a.divide(b);
    case '^':
      return evaluatePower(a, b);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Estrategias de combinación
// ---------------------------------------------------------------------------------------------------------

/** `g1 * g2 * … * Q`: solo si el producto de las piezas no es cero y el cociente que falta es escribible. */
function multiplicative(
  gadgets: readonly Piece[],
  target: Fraction,
  writer: NumberWriter,
  minNumbers: number,
): Piece | null {
  if (!writer.usable('*')) return null;
  let chain: Piece | null = gadgets[0];
  for (const gadget of gadgets.slice(1)) {
    chain = chain === null ? null : binary('*', chain, gadget);
  }
  if (chain === null || chain.value.isZero()) return null;
  const quotient = target.divide(chain.value);
  // Solo si el objetivo es múltiplo entero de las piezas (si no, la estrategia aditiva es más natural).
  if (!quotient.isInteger()) return null;
  const missing = Math.max(0, minNumbers - chain.literals);
  if (quotient.equals(ONE) && missing === 0) return chain;
  const factor = writer.withLiterals(quotient, Math.max(1, missing));
  return factor === null ? null : binary('*', chain, factor);
}

/** `g1 + g2 + … + R` (o `… - R`): las piezas más (o menos) el resto que falta, repartido si faltan números. */
function additive(
  gadgets: readonly Piece[],
  target: Fraction,
  writer: NumberWriter,
  rng: SeededRandom,
  minNumbers: number,
): Piece | null {
  let chain: Piece | null = gadgets[0];
  for (const gadget of gadgets.slice(1)) {
    chain = chain === null ? null : writer.join(chain, gadget);
  }
  if (chain === null) return null;
  const remainder = target.subtract(chain.value);
  const missing = Math.max(0, minNumbers - chain.literals);
  if (remainder.isZero() && missing === 0) return chain;

  // Resto negativo: preferimos `… - R` a `… + (-R)`.
  const subtract = remainder.isNegative() ? writer.usable('-') : !writer.usable('+') && writer.usable('-');
  if (subtract) {
    const rest = writer.withLiterals(remainder.negate(), Math.max(1, missing));
    return rest === null ? null : binary('-', chain, rest);
  }
  if (!writer.usable('+')) return null;
  const rest = writer.withLiterals(remainder, Math.max(1, missing));
  if (rest === null) return null;
  return rng.chance(0.25) && !gadgets.some((g) => g.prec === 3)
    ? binary('+', rest, chain)
    : binary('+', chain, rest);
}

// ---------------------------------------------------------------------------------------------------------
// Escritor de números
// ---------------------------------------------------------------------------------------------------------

/**
 * Escribe números exactos usando solo dígitos permitidos, literales ≤ máximo y operadores no prohibidos.
 * Toda búsqueda está acotada (pasos, profundidad, factores) y cada recursión estrictamente reduce el número.
 */
class NumberWriter {
  private steps = 0;
  private readonly allowedChars: ReadonlySet<string>;
  private readonly operators: ReadonlySet<BinaryOperator>;
  private readonly max: bigint | null;
  private readonly syntax: MathSyntax;
  /** Literales enteros permitidos entre 1 y 20 (≤ máximo), ascendentes. */
  private readonly small: readonly number[];

  /** @param allowed dígitos permitidos, ascendentes y no vacíos. */
  constructor(
    constraints: RuleConstraints,
    private readonly allowed: readonly number[],
    private readonly rng: SeededRandom,
  ) {
    this.allowedChars = new Set(allowed.map(String));
    this.syntax = constraints.syntax ?? DEFAULT_MATH_SYNTAX;
    const forbidden = new Set(constraints.forbiddenOperators);
    this.operators = new Set(
      BINARY_OPERATORS.filter((op) => !forbidden.has(op) && (op !== '^' || this.syntax.powers)),
    );
    this.max = constraints.maxNumber === null ? null : BigInt(constraints.maxNumber);
    this.small = Array.from({ length: 20 }, (_, i) => i + 1).filter((n) => this.isAllowedInteger(BigInt(n)));
  }

  usable(operator: BinaryOperator): boolean {
    return this.operators.has(operator);
  }

  /** Une dos piezas con `+` (o, si está prohibido, restando su opuesto). */
  join(left: Piece, right: Piece): Piece | null {
    if (this.usable('+')) return binary('+', left, right);
    if (this.usable('-')) return binary('-', left, negate(right));
    return null;
  }

  /** Escribe `value` con al menos `count` literales, repartiéndolo en sumandos si hace falta. */
  withLiterals(value: Fraction, count: number): Piece | null {
    const piece = this.rational(value);
    if (piece === null || piece.literals >= count) return piece;
    if (!this.usable('+') && !this.usable('-')) return null;
    // value = a + (value - a), con `a` un literal pequeño permitido.
    const a = this.pickSmall();
    if (a === null) return null;
    const rest = this.withLiterals(value.subtract(Fraction.of(a)), count - 1);
    if (rest === null) return null;
    const head = atom(String(a), Fraction.of(a));
    if (this.usable('+')) return binary('+', head, rest);
    return binary('-', head, negate(rest));
  }

  /** Entero (posiblemente negativo), fracción `p / q` exacta o decimal exacto. */
  rational(value: Fraction): Piece | null {
    if (value.isInteger()) return this.integer(value.numerator);
    if (value.isNegative()) {
      const magnitude = this.rational(value.negate());
      return magnitude === null ? null : negate(magnitude);
    }

    const options: Array<() => Piece | null> = [];
    const decimal = this.syntax.decimals ? value.toTerminatingDecimal() : null;
    if (decimal !== null) {
      if (this.isAllowedLiteral(decimal, value)) return atom(decimal, value);
      options.push(() => this.decimalSplit(value));
    }
    if (this.usable('/')) {
      options.push(() => {
        const numerator = this.natural(value.numerator);
        const denominator = this.natural(value.denominator);
        return numerator === null || denominator === null ? null : binary('/', numerator, denominator);
      });
    }
    // Con decimales, `61 + 0.15` es más natural que `1223 / 20`: el decimal va primero.
    for (const option of options) {
      const piece = option();
      if (piece !== null) return piece;
    }
    return null;
  }

  // ----- piezas para reglas positivas -----

  /** @param target valor final: la potencia se elige pequeña frente a él (no `9 ^ 4` para llegar a 5). */
  operatorGadget(operator: BinaryOperator, target: Fraction = ONE): Piece | null {
    const a = this.pickSmall(2);
    const b = this.pickSmall(2);
    if (a === null || b === null) return null;
    const lit = (n: number) => atom(String(n), Fraction.of(n));
    switch (operator) {
      case '+':
        return binary('+', lit(a), lit(b));
      case '-':
        return binary('-', lit(Math.max(a, b)), lit(Math.min(a, b)));
      case '*':
        return binary('*', lit(a), lit(b));
      case '/': {
        // Preferimos una división exacta `(q · d) / d` con literales permitidos: `12 / 4`.
        const exact: Array<[number, number]> = [];
        for (const d of this.small.filter((n) => n >= 2 && n <= 9)) {
          for (const q of this.small.filter((n) => n >= 2 && n <= 9)) {
            if (this.isAllowedInteger(BigInt(q * d))) exact.push([q * d, d]);
          }
        }
        if (exact.length > 0) {
          const [dividend, divisor] = this.rng.pick(exact);
          return binary('/', lit(dividend), lit(divisor));
        }
        return binary('/', lit(a), lit(b));
      }
      case '^': {
        const exponents = [2, 3, 4].filter((e) => this.isAllowedInteger(BigInt(e)));
        const bases = this.small.filter((n) => n >= 2 && n <= 9);
        const pairs = bases.flatMap((b) => exponents.map((e) => ({ b, e, value: b ** e })));
        if (pairs.length > 0) {
          const magnitude = target.abs();
          const limit = Math.max(16, Math.min(200, Number(magnitude.numerator / magnitude.denominator)));
          const fitting = pairs.filter((p) => p.value <= limit);
          const { b, e } =
            fitting.length > 0 ? this.rng.pick(fitting) : pairs.reduce((a, c) => (c.value < a.value ? c : a));
          return binary('^', lit(b), lit(e));
        }
        // Sin exponentes pequeños permitidos: `b ^ 1` o `1 ^ b` siguen siendo potencias.
        if (this.isAllowedInteger(1n) && bases.length > 0)
          return binary('^', lit(this.rng.pick(bases)), lit(1));
        return null;
      }
    }
  }

  negativeGadget(): Piece | null {
    const a = this.pickSmall(1);
    return a === null ? null : negate(atom(String(a), Fraction.of(a)));
  }

  decimalGadget(): Piece | null {
    const candidates = DECIMAL_CANDIDATES.map((text) => ({ text, value: parseDecimal(text) })).filter(
      ({ text, value }) => this.isAllowedLiteral(text, value),
    );
    if (candidates.length === 0) return null;
    const first = this.rng.pick(candidates);
    const single = atom(first.text, first.value);
    // Preferimos una pieza de valor entero para no complicar el resto: `0.2 + 0.8`, `0.5 * 4`.
    const options: Array<() => Piece | null> = [];
    if (this.usable('+')) {
      options.push(() => {
        const complement = candidates.find(({ value }) => value.add(first.value).isInteger());
        return complement ? binary('+', single, atom(complement.text, complement.value)) : null;
      });
    }
    if (this.usable('*')) {
      options.push(() => {
        const factor = this.small.find((n) => n >= 2 && first.value.multiply(Fraction.of(n)).isInteger());
        return factor === undefined ? null : binary('*', single, atom(String(factor), Fraction.of(factor)));
      });
    }
    for (const option of this.rng.shuffle(options)) {
      const piece = option();
      if (piece !== null) return piece;
    }
    return single;
  }

  /** Una pieza con paréntesis NECESARIOS: `(a + b) * c`, `c * (a - b)`, `-(a + b)`, `a - (b + c)`… */
  parenthesesGadget(): Piece | null {
    const a = this.pickSmall(1);
    const b = this.pickSmall(1);
    const c = this.pickSmall(2);
    if (a === null || b === null || c === null) return null;
    const lit = (n: number) => atom(String(n), Fraction.of(n));
    const [hi, lo] = a >= b ? [a, b] : [b, a];
    const options: Array<() => Piece | null> = [];
    const sum = () => binary('+', lit(a), lit(b));
    const difference = () => (hi === lo ? null : binary('-', lit(hi), lit(lo)));
    const inner = () => (this.usable('+') ? sum() : this.usable('-') ? difference() : null);
    if (this.usable('*')) {
      options.push(() => {
        const group = inner();
        return group === null ? null : binary('*', group, lit(c));
      });
      options.push(() => {
        const group = inner();
        return group === null ? null : binary('*', lit(c), group);
      });
    }
    options.push(() => {
      const group = inner();
      return group === null ? null : negate(group);
    });
    if (this.usable('-')) {
      options.push(() => {
        const group = inner();
        return group === null ? null : binary('-', lit(c + hi), group);
      });
    }
    if (this.usable('*') && !this.usable('+') && !this.usable('-')) {
      options.push(() => {
        const product = binary('*', lit(a), lit(c));
        return product === null ? null : negate(product);
      });
    }
    if (this.usable('/') && !this.usable('*')) {
      options.push(() => {
        const group = inner();
        return group === null ? null : binary('/', group, lit(c));
      });
    }
    if (this.usable('^') && options.length === 0) {
      options.push(() => {
        const power = binary('^', lit(c), lit(1));
        return power === null ? null : binary('^', power, lit(1));
      });
    }
    for (const option of this.rng.shuffle(options)) {
      const piece = option();
      if (piece !== null) return piece;
    }
    return null;
  }

  // ----- enteros -----

  private integer(value: bigint): Piece | null {
    if (value >= 0n) return this.natural(value);
    const magnitude = this.natural(-value);
    return magnitude === null ? null : negate(magnitude);
  }

  private natural(n: bigint, depth = 0): Piece | null {
    this.steps += 1;
    if (this.steps > MAX_WRITER_STEPS || depth > MAX_WRITER_DEPTH) return null;
    if (this.isAllowedInteger(n)) return atom(n.toString(), Fraction.of(n));

    if (n === 0n) {
      // El 0 está prohibido: `a - a` (o `-a + a`) con un literal permitido distinto de cero.
      const a = this.pickSmall(1);
      if (a === null) return null;
      const lit = atom(String(a), Fraction.of(a));
      if (this.usable('-')) return binary('-', lit, lit);
      if (this.usable('+')) return binary('+', negate(lit), lit);
      return null;
    }

    let options = this.rng.shuffle(['factor', 'divmod', 'near', 'over', 'quotient'] as const);
    if (n <= 20n) {
      // Números pequeños: `9 + 1` o `2 * 5` antes que `1 * 9 + 1`.
      options = [...options.filter((o) => o !== 'divmod'), 'divmod'];
    } else if (this.max !== null && n > this.max * 3n) {
      // Con un máximo pequeño, sumar o restar el literal más cercano produce cadenas larguísimas.
      options = [...options.filter((o) => o !== 'near' && o !== 'over'), 'near', 'over'];
    }
    for (const option of options) {
      let piece: Piece | null = null;
      switch (option) {
        case 'factor':
          piece = this.factor(n);
          break;
        case 'divmod':
          piece = this.divmod(n, depth);
          break;
        case 'near':
          piece = this.near(n, depth);
          break;
        case 'over':
          piece = this.over(n, depth);
          break;
        case 'quotient':
          piece = this.quotient(n);
          break;
      }
      if (piece !== null) return piece;
    }
    return null;
  }

  private isAllowedInteger(n: bigint): boolean {
    if (n < 0n) return false;
    if (this.max !== null && n > this.max) return false;
    return [...n.toString()].every((char) => this.allowedChars.has(char));
  }

  /** Literal (entero o decimal `a.b`) con dígitos permitidos y valor ≤ máximo. */
  private isAllowedLiteral(text: string, value: Fraction): boolean {
    if (this.max !== null && value.compare(Fraction.of(this.max)) > 0) return false;
    return [...text].every((char) => char === '.' || this.allowedChars.has(char));
  }

  /** Literal pequeño permitido ≥ `min` (los más pequeños, con preferencia, para no crecer el texto). */
  private pickSmall(min = 1): number | null {
    const options = this.small.filter((n) => n >= min && n <= 9);
    const pool = options.length > 0 ? options : this.small.filter((n) => n >= min);
    return pool.length === 0 ? null : this.rng.pick(pool);
  }

  /** `x * y` con ambos literales permitidos. */
  private factor(n: bigint): Piece | null {
    if (!this.usable('*') || n < 4n || n > FACTOR_MAX_N) return null;
    const value = Number(n);
    const limit = Math.min(Math.floor(Math.sqrt(value)), FACTOR_SCAN_LIMIT);
    const pairs: Array<[number, number]> = [];
    for (let d = 2; d <= limit && pairs.length < FACTOR_PAIRS_LIMIT; d++) {
      if (value % d !== 0) continue;
      const other = value / d;
      if (this.isAllowedInteger(BigInt(d)) && this.isAllowedInteger(BigInt(other))) pairs.push([d, other]);
    }
    if (pairs.length === 0) return null;
    const [a, b] = this.rng.pick(pairs);
    const [x, y] = this.rng.chance(0.5) ? [a, b] : [b, a];
    return binary('*', atom(String(x), Fraction.of(x)), atom(String(y), Fraction.of(y)));
  }

  /** `q * m + r` con `m` un literal permitido (sirve cuando el máximo es pequeño: 297 → `(2 * 10 + 9) * 10 + 7`). */
  private divmod(n: bigint, depth: number): Piece | null {
    if (!this.usable('*')) return null;
    const candidates = this.small.filter((m) => m >= 2 && BigInt(m) < n);
    if (candidates.length === 0) return null;
    // Los mayores dan expresiones más cortas; algo de azar da variedad.
    const m = BigInt(this.rng.pick(candidates.slice(-3)));
    const q = n / m;
    const r = n % m;
    const quotient = this.natural(q, depth + 1);
    if (quotient === null) return null;
    const product = binary('*', quotient, atom(m.toString(), Fraction.of(m)));
    if (product === null || r === 0n) return product;
    if (this.usable('+')) {
      const rest = this.natural(r, depth + 1);
      return rest === null ? null : binary('+', product, rest);
    }
    if (this.usable('-')) {
      const upper = this.natural(q + 1n, depth + 1);
      const rest = this.natural(m - r, depth + 1);
      if (upper === null || rest === null) return null;
      const bigger = binary('*', upper, atom(m.toString(), Fraction.of(m)));
      return bigger === null ? null : binary('-', bigger, rest);
    }
    return null;
  }

  /** `m + resto`, con `m` el mayor literal permitido ≤ n (y ≤ máximo). */
  private near(n: bigint, depth: number): Piece | null {
    if (!this.usable('+')) return null;
    const m = this.largestAllowedAtMost(this.max !== null && this.max < n ? this.max : n);
    if (m === null || m >= n || m === 0n) return null;
    const rest = this.natural(n - m, depth + 1);
    return rest === null ? null : binary('+', atom(m.toString(), Fraction.of(m)), rest);
  }

  /** `m - resto`, con `m` el menor literal permitido ≥ n; solo si el resto es menor que n (progreso). */
  private over(n: bigint, depth: number): Piece | null {
    if (!this.usable('-')) return null;
    const m = this.smallestAllowedAtLeast(n);
    if (m === null || m - n >= n || (this.max !== null && m > this.max)) return null;
    const rest = this.natural(m - n, depth + 1);
    return rest === null ? null : binary('-', atom(m.toString(), Fraction.of(m)), rest);
  }

  /** `(n · k) / k` con ambos literales permitidos (útil si faltan `+ - *`). */
  private quotient(n: bigint): Piece | null {
    if (!this.usable('/')) return null;
    for (const k of this.small) {
      if (k < 2) continue;
      const product = n * BigInt(k);
      if (this.isAllowedInteger(product)) {
        return binary('/', atom(product.toString(), Fraction.of(product)), atom(String(k), Fraction.of(k)));
      }
    }
    return null;
  }

  /** Decimal exacto como `entero + parte decimal` cuando el literal completo no está permitido. */
  private decimalSplit(value: Fraction): Piece | null {
    const whole = value.numerator / value.denominator;
    const fraction = value.subtract(Fraction.of(whole));
    const fractionText = fraction.toTerminatingDecimal();
    if (fractionText === null) return null;
    if (this.isAllowedLiteral(fractionText, fraction) && whole > 0n && this.usable('+')) {
      const head = this.natural(whole);
      return head === null ? null : binary('+', head, atom(fractionText, fraction));
    }
    // p. ej. 0.5 con el 5 prohibido: `0.6 - 0.1`, `1 - 0.5`… se prueba con un decimal permitido.
    for (const text of DECIMAL_CANDIDATES) {
      const candidate = parseDecimal(text);
      if (!this.isAllowedLiteral(text, candidate)) continue;
      const rest = value.subtract(candidate);
      const restText = rest.isNegative() ? null : rest.toTerminatingDecimal();
      if (restText !== null && !rest.isZero() && this.isAllowedLiteral(restText, rest) && this.usable('+')) {
        return binary('+', atom(text, candidate), atom(restText, rest));
      }
    }
    return null;
  }

  /** Mayor entero positivo con solo dígitos permitidos y ≤ n (sin ceros a la izquierda). */
  private largestAllowedAtMost(n: bigint): bigint | null {
    const s = n.toString();
    const maxDigit = this.allowed[this.allowed.length - 1];
    let prefix = 0;
    while (prefix < s.length && this.allowedChars.has(s[prefix])) prefix += 1;
    if (prefix === s.length) return n;

    for (let i = Math.min(prefix, s.length - 1); i >= 0; i--) {
      const smaller = [...this.allowed].reverse().find((d) => d < Number(s[i]) && (i > 0 || d >= 1));
      if (smaller !== undefined)
        return BigInt(s.slice(0, i) + smaller + String(maxDigit).repeat(s.length - i - 1));
    }
    return s.length > 1 && maxDigit > 0 ? BigInt(String(maxDigit).repeat(s.length - 1)) : null;
  }

  /** Menor entero con solo dígitos permitidos y ≥ n. */
  private smallestAllowedAtLeast(n: bigint): bigint | null {
    const s = n.toString();
    const minDigit = this.allowed[0];
    let prefix = 0;
    while (prefix < s.length && this.allowedChars.has(s[prefix])) prefix += 1;

    for (let i = Math.min(prefix, s.length - 1); i >= 0; i--) {
      const larger = this.allowed.find((d) => d > Number(s[i]));
      if (larger !== undefined)
        return BigInt(s.slice(0, i) + larger + String(minDigit).repeat(s.length - i - 1));
    }
    const lead = this.allowed.find((d) => d >= 1);
    return lead === undefined ? null : BigInt(String(lead) + String(minDigit).repeat(s.length));
  }
}

function parseDecimal(text: string): Fraction {
  const [whole, fraction = ''] = text.split('.');
  return Fraction.of(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
}
