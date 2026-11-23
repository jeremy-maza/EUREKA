import { ExpressionNode, numberValue } from './ast';
import { Fraction } from './fraction';
import { InvalidPowerError } from './math.errors';

/** Mayor exponente (en valor absoluto) que se evalúa: `2 ^ 12` sí, `2 ^ 13` no. */
export const MAX_POWER_EXPONENT = 12;
/** Tamaño máximo (en bits del numerador y del denominador) del resultado de una potencia. */
export const MAX_POWER_RESULT_BITS = 2048;

function bitLength(value: bigint): number {
  return (value < 0n ? -value : value).toString(2).length;
}

/**
 * `base ^ exponente` exacto y ACOTADO: el exponente debe valer un entero con |e| ≤ 12 y el resultado
 * no puede superar ~2048 bits (se estima antes de calcularlo, así que nunca se intenta una potencia
 * desmesurada). `0 ^ 0` no está definido y `0 ^ -n` divide entre cero.
 *
 * @throws InvalidPowerError | DivisionByZeroError
 */
export function evaluatePower(base: Fraction, exponent: Fraction): Fraction {
  if (!exponent.isInteger()) {
    throw new InvalidPowerError(
      'NON_INTEGER_EXPONENT',
      `El exponente de una potencia debe ser un número entero, pero vale ${exponent}.`,
    );
  }
  const e = exponent.numerator;
  const magnitude = e < 0n ? -e : e;
  if (magnitude > BigInt(MAX_POWER_EXPONENT)) {
    throw new InvalidPowerError(
      'EXPONENT_TOO_LARGE',
      `El exponente ${e} es demasiado grande: usa exponentes entre -${MAX_POWER_EXPONENT} y ${MAX_POWER_EXPONENT}.`,
    );
  }
  if (base.isZero() && e === 0n) {
    throw new InvalidPowerError('ZERO_TO_ZERO', '0 ^ 0 no está definido.');
  }
  const bits = Math.max(bitLength(base.numerator), bitLength(base.denominator)) * Number(magnitude);
  if (bits > MAX_POWER_RESULT_BITS) {
    throw new InvalidPowerError('RESULT_TOO_LARGE', 'El resultado de la potencia es demasiado grande.');
  }
  return base.pow(e);
}

/**
 * Evalúa un AST con aritmética racional exacta. Es una función pura del árbol:
 * no usa `eval`, `Function` ni el texto original del jugador.
 */
export class MathEvaluator {
  /** @throws DivisionByZeroError cuando algún divisor vale cero; InvalidPowerError en potencias no evaluables. */
  evaluate(node: ExpressionNode): Fraction {
    switch (node.kind) {
      case 'number':
        return numberValue(node);
      case 'negation':
        return this.evaluate(node.operand).negate();
      case 'variable':
        // El parser solo produce incógnitas en enunciados de ecuación, que se resuelven con `solveLinearEquation`.
        throw new Error('La incógnita x no tiene valor: las ecuaciones se resuelven, no se evalúan.');
      case 'binary': {
        const left = this.evaluate(node.left);
        const right = this.evaluate(node.right);
        switch (node.operator) {
          case '+':
            return left.add(right);
          case '-':
            return left.subtract(right);
          case '*':
            return left.multiply(right);
          case '/':
            return left.divide(right);
          case '^':
            return evaluatePower(left, right);
        }
      }
    }
  }
}
