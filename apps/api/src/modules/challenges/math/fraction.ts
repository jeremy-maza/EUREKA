import { DivisionByZeroError } from './math.errors';

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

/**
 * Número racional exacto (numerador/denominador `bigint`, siempre normalizado).
 * Evita errores de coma flotante: `7 / 2 * 2` vale exactamente `7`.
 */
export class Fraction {
  private constructor(
    readonly numerator: bigint,
    readonly denominator: bigint,
  ) {}

  static of(numerator: bigint | number, denominator: bigint | number = 1n): Fraction {
    let n = BigInt(numerator);
    let d = BigInt(denominator);
    if (d === 0n) throw new DivisionByZeroError();
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const divisor = gcd(n, d);
    return new Fraction(n / divisor, d / divisor);
  }

  /** Parsea la forma canónica `"21"`, `"-3"` o `"7/2"` (la que produce `toString`). */
  static parse(text: string): Fraction {
    const match = /^(-?\d+)(?:\/(\d+))?$/.exec(text.trim());
    if (!match) throw new Error(`Fracción inválida: "${text}"`);
    return Fraction.of(BigInt(match[1]), match[2] === undefined ? 1n : BigInt(match[2]));
  }

  add(other: Fraction): Fraction {
    return Fraction.of(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  subtract(other: Fraction): Fraction {
    return this.add(other.negate());
  }

  multiply(other: Fraction): Fraction {
    return Fraction.of(this.numerator * other.numerator, this.denominator * other.denominator);
  }

  /** @throws DivisionByZeroError si `other` es cero. */
  divide(other: Fraction): Fraction {
    if (other.isZero()) throw new DivisionByZeroError();
    return Fraction.of(this.numerator * other.denominator, this.denominator * other.numerator);
  }

  negate(): Fraction {
    return new Fraction(-this.numerator, this.denominator);
  }

  equals(other: Fraction): boolean {
    // Ambas están normalizadas, la igualdad es estructural.
    return this.numerator === other.numerator && this.denominator === other.denominator;
  }

  isZero(): boolean {
    return this.numerator === 0n;
  }

  isInteger(): boolean {
    return this.denominator === 1n;
  }

  isNegative(): boolean {
    return this.numerator < 0n;
  }

  abs(): Fraction {
    return this.isNegative() ? this.negate() : this;
  }

  /** Negativo, cero o positivo según `this` sea menor, igual o mayor que `other`. */
  compare(other: Fraction): number {
    const difference = this.numerator * other.denominator - other.numerator * this.denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }

  /**
   * Potencia de exponente entero (el llamador acota el tamaño). `0 ^ -n` divide entre cero.
   * @throws DivisionByZeroError
   */
  pow(exponent: bigint): Fraction {
    if (exponent < 0n) {
      if (this.isZero()) throw new DivisionByZeroError();
      return Fraction.of(this.denominator ** -exponent, this.numerator ** -exponent);
    }
    return Fraction.of(this.numerator ** exponent, this.denominator ** exponent);
  }

  /**
   * Escritura decimal exacta si existe (denominador de la forma 2^a·5^b): `5/4` → `"1.25"`, `-1/2` → `"-0.5"`,
   * `7` → `"7"`. Devuelve `null` si el decimal es periódico (`1/3`).
   */
  toTerminatingDecimal(): string | null {
    let rest = this.denominator;
    let twos = 0;
    let fives = 0;
    while (rest % 2n === 0n) {
      rest /= 2n;
      twos += 1;
    }
    while (rest % 5n === 0n) {
      rest /= 5n;
      fives += 1;
    }
    if (rest !== 1n) return null;
    const places = Math.max(twos, fives);
    if (places === 0) return this.numerator.toString();
    const scaled =
      ((this.numerator < 0n ? -this.numerator : this.numerator) * 10n ** BigInt(places)) / this.denominator;
    const digits = scaled.toString().padStart(places + 1, '0');
    const text = `${digits.slice(0, -places)}.${digits.slice(-places)}`;
    return this.numerator < 0n ? `-${text}` : text;
  }

  /** Forma canónica: `"21"` o `"7/2"`. */
  toString(): string {
    return this.isInteger() ? this.numerator.toString() : `${this.numerator}/${this.denominator}`;
  }
}
