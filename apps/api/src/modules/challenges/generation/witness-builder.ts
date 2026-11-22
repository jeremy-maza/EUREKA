import {
  DEFAULT_MAX_EXPRESSION_LENGTH,
  DivisionByZeroError,
  ExpressionNode,
  ExpressionParser,
  ExpressionSyntaxError,
  Fraction,
  MathEvaluator,
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

export type WitnessStrategy = 'DIRECT' | 'MULTIPLICATIVE' | 'ADDITIVE';

/** Un trozo de texto y si puede usarse como operando sin paréntesis (literal). */
interface Piece {
  text: string;
  atomic: boolean;
}

/** Pasos máximos del escritor de enteros por construcción (acota la recursión y los bucles). */
const MAX_WRITER_STEPS = 200;
const MAX_WRITER_DEPTH = 8;
/** Búsqueda de factores: solo para n ≤ 10^12 y como mucho hasta 5000. */
const FACTOR_MAX_N = 1_000_000_000_000n;
const FACTOR_SCAN_LIMIT = 5000;
const FACTOR_PAIRS_LIMIT = 8;

const ALL_DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Construye de forma CONSTRUCTIVA (sin búsqueda exhaustiva) una solución de referencia para un valor
 * objetivo que cumpla todas las reglas soportadas (FORBIDDEN_DIGIT, REQUIRED_OPERATION):
 *
 *  - Cada operación exigida se escribe entre paréntesis, `(7 * 1)`, para esquivar la limitación
 *    conocida de `REQUIRED_OPERATION` (`2 * 7 * 1` es `(2 * 7) * 1` y no contiene `7 * 1`).
 *  - Los números se escriben solo con dígitos permitidos (literal directo, producto de dos literales,
 *    o suma/resta con el literal permitido más cercano).
 *  - Se combinan las operaciones exigidas con el resto de forma multiplicativa (`(7 * 1) * 3`) o aditiva
 *    (`(7 * 1) + 14`).
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
  ): WitnessVerification {
    const { parser, evaluator, ruleEngine } = this.deps;

    if (source.length > maxLength) {
      return rejected('TOO_LONG', `La solución mide ${source.length} caracteres (máximo ${maxLength}).`);
    }

    let expression: ExpressionNode;
    try {
      expression = parser.parseExpression(source);
    } catch (error) {
      if (error instanceof ExpressionSyntaxError) return rejected('SYNTAX_ERROR', error.message);
      throw error;
    }

    let value: Fraction;
    try {
      value = evaluator.evaluate(expression);
    } catch (error) {
      if (error instanceof DivisionByZeroError) return rejected('EVALUATION_ERROR', error.message);
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

    const writer = new NumberWriter(allowedDigits, rng);
    const terms = this.requiredTerms(constraints);
    if (terms === null) return NO_WITNESS;

    const strategies: Array<{ name: WitnessStrategy; run: () => string | null }> = [];
    if (terms.length === 0) {
      strategies.push({ name: 'DIRECT', run: () => writer.rational(target)?.text ?? null });
    } else {
      strategies.push({ name: 'MULTIPLICATIVE', run: () => multiplicative(terms, target, writer) });
      strategies.push({ name: 'ADDITIVE', run: () => additive(terms, target, writer) });
    }

    for (const { name, run } of rng.shuffle(strategies)) {
      const source = run();
      if (source === null) continue;
      if (this.verify(source, target, constraints.rules, maxLength).valid) {
        return { ok: true, expression: source, strategy: name };
      }
    }
    return NO_WITNESS;
  }

  /** `(l op r)` por cada operación exigida, con su valor evaluado; `null` si alguna no es evaluable. */
  private requiredTerms(constraints: RuleConstraints): Array<{ text: string; value: Fraction }> | null {
    const { parser, evaluator } = this.deps;
    const terms: Array<{ text: string; value: Fraction }> = [];
    for (const { operator, left, right } of constraints.requiredOperations) {
      const text = `(${left} ${operator} ${right})`;
      try {
        terms.push({ text, value: evaluator.evaluate(parser.parseExpression(text)) });
      } catch (error) {
        if (error instanceof DivisionByZeroError || error instanceof ExpressionSyntaxError) return null;
        throw error;
      }
    }
    return terms;
  }
}

const NO_WITNESS: WitnessBuildResult = { ok: false, reason: 'NO_WITNESS_FOUND' };

function rejected(reason: WitnessRejectionReason, message: string): WitnessVerification {
  return { valid: false, reason, message };
}

/** `(7 * 1) * (6 + 1)`: solo si el objetivo es múltiplo entero del producto de las operaciones. */
function multiplicative(
  terms: ReadonlyArray<{ text: string; value: Fraction }>,
  target: Fraction,
  writer: NumberWriter,
): string | null {
  const productValue = terms.reduce((acc, term) => acc.multiply(term.value), Fraction.of(1));
  if (productValue.isZero()) return null;
  const quotient = target.divide(productValue);
  if (!quotient.isInteger()) return null;

  const base = terms.map((term) => term.text).join(' * ');
  if (quotient.equals(Fraction.of(1))) return base;
  const factor = writer.rational(quotient);
  return factor === null ? null : `${base} * ${operand(factor)}`;
}

/** `(7 * 1) + 14`, `(7 * 1) - (1 + 5)`: las operaciones exigidas más (o menos) el resto. */
function additive(
  terms: ReadonlyArray<{ text: string; value: Fraction }>,
  target: Fraction,
  writer: NumberWriter,
): string | null {
  const base = terms.map((term) => term.text).join(' + ');
  const remainder = target.subtract(terms.reduce((acc, term) => acc.add(term.value), Fraction.of(0)));
  if (remainder.isZero()) return base;

  const negative = remainder.numerator < 0n;
  const piece = writer.rational(negative ? remainder.negate() : remainder);
  return piece === null ? null : `${base} ${negative ? '-' : '+'} ${operand(piece)}`;
}

function operand(piece: Piece): string {
  return piece.atomic ? piece.text : `(${piece.text})`;
}

/**
 * Escribe números exactos usando solo dígitos permitidos. Toda búsqueda está acotada
 * (pasos, profundidad, factores) y cada recursión estrictamente reduce el número.
 */
class NumberWriter {
  private steps = 0;
  private readonly allowedChars: ReadonlySet<string>;

  /** @param allowed dígitos permitidos, ascendentes y no vacíos. */
  constructor(
    private readonly allowed: readonly number[],
    private readonly rng: SeededRandom,
  ) {
    this.allowedChars = new Set(allowed.map(String));
  }

  /** Entero (posiblemente negativo) o fracción `p / q` exacta. */
  rational(value: Fraction): Piece | null {
    if (value.isInteger()) return this.integer(value.numerator);

    const numerator = this.natural(value.numerator < 0n ? -value.numerator : value.numerator);
    const denominator = this.natural(value.denominator);
    if (numerator === null || denominator === null) return null;
    const text = `${operand(numerator)} / ${operand(denominator)}`;
    return { text: value.numerator < 0n ? `-(${text})` : text, atomic: false };
  }

  private integer(value: bigint): Piece | null {
    if (value >= 0n) return this.natural(value);
    const magnitude = this.natural(-value);
    return magnitude === null ? null : { text: `-${operand(magnitude)}`, atomic: false };
  }

  private natural(n: bigint, depth = 0): Piece | null {
    this.steps += 1;
    if (this.steps > MAX_WRITER_STEPS || depth > MAX_WRITER_DEPTH) return null;
    if (this.isAllowedLiteral(n)) return { text: n.toString(), atomic: true };

    if (n === 0n) {
      // El 0 está prohibido: `a - a` con un dígito permitido distinto de cero.
      const nonZero = this.allowed.filter((digit) => digit > 0);
      if (nonZero.length === 0) return null;
      const digit = this.rng.pick(nonZero);
      return { text: `${digit} - ${digit}`, atomic: false };
    }

    const options = this.rng.shuffle(['factor', 'near', 'over'] as const);
    for (const option of options) {
      const piece =
        option === 'factor' ? this.factor(n) : option === 'near' ? this.near(n, depth) : this.over(n, depth);
      if (piece !== null) return piece;
    }
    return null;
  }

  private isAllowedLiteral(n: bigint): boolean {
    return [...n.toString()].every((char) => this.allowedChars.has(char));
  }

  /** `x * y` con ambos literales permitidos. */
  private factor(n: bigint): Piece | null {
    if (n < 4n || n > FACTOR_MAX_N) return null;
    const value = Number(n);
    const limit = Math.min(Math.floor(Math.sqrt(value)), FACTOR_SCAN_LIMIT);
    const pairs: Array<[number, number]> = [];
    for (let d = 2; d <= limit && pairs.length < FACTOR_PAIRS_LIMIT; d++) {
      if (value % d !== 0) continue;
      const other = value / d;
      if (this.isAllowedLiteral(BigInt(d)) && this.isAllowedLiteral(BigInt(other))) pairs.push([d, other]);
    }
    if (pairs.length === 0) return null;
    const [a, b] = this.rng.pick(pairs);
    const [x, y] = this.rng.chance(0.5) ? [a, b] : [b, a];
    return { text: `${x} * ${y}`, atomic: false };
  }

  /** `m + resto`, con `m` el mayor literal permitido ≤ n. */
  private near(n: bigint, depth: number): Piece | null {
    const m = this.largestAllowedAtMost(n);
    if (m === null) return null;
    const rest = this.natural(n - m, depth + 1);
    return rest === null ? null : { text: `${m} + ${operand(rest)}`, atomic: false };
  }

  /** `m - resto`, con `m` el menor literal permitido ≥ n; solo si el resto es menor que n (progreso). */
  private over(n: bigint, depth: number): Piece | null {
    const m = this.smallestAllowedAtLeast(n);
    if (m === null || m - n >= n) return null;
    const rest = this.natural(m - n, depth + 1);
    return rest === null ? null : { text: `${m} - ${operand(rest)}`, atomic: false };
  }

  /** Mayor entero positivo con solo dígitos permitidos y ≤ n (sin ceros a la izquierda). */
  private largestAllowedAtMost(n: bigint): bigint | null {
    const s = n.toString();
    const maxDigit = this.allowed[this.allowed.length - 1];
    let prefix = 0;
    while (prefix < s.length && this.allowedChars.has(s[prefix])) prefix += 1;

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
