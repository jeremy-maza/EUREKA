import { ExpressionNode, numberValue } from './ast';
import { ParsedEquation } from './expression-parser';
import { Fraction } from './fraction';
import { evaluatePower } from './math-evaluator';
import { EquationError } from './math.errors';

/** Expresión lineal en `x`: `coefficient · x + constant`. */
export interface LinearForm {
  coefficient: Fraction;
  constant: Fraction;
}

const ZERO = Fraction.of(0);
const ONE = Fraction.of(1);

const nonLinear = (detail: string) => new EquationError('NON_LINEAR', `La ecuación no es lineal: ${detail}`);

/**
 * Reduce un AST (con la incógnita `x`) a `a · x + b` con aritmética exacta. Rechaza todo lo que no sea
 * lineal: producto de dos términos con `x`, `x` en un divisor o en un exponente, y potencias de `x`
 * distintas de `x ^ 1`.
 *
 * @throws EquationError('NON_LINEAR') | DivisionByZeroError | InvalidPowerError
 */
export function linearize(node: ExpressionNode): LinearForm {
  switch (node.kind) {
    case 'number':
      return { coefficient: ZERO, constant: numberValue(node) };
    case 'variable':
      return { coefficient: ONE, constant: ZERO };
    case 'negation': {
      const inner = linearize(node.operand);
      return { coefficient: inner.coefficient.negate(), constant: inner.constant.negate() };
    }
    case 'binary': {
      const left = linearize(node.left);
      const right = linearize(node.right);
      switch (node.operator) {
        case '+':
          return {
            coefficient: left.coefficient.add(right.coefficient),
            constant: left.constant.add(right.constant),
          };
        case '-':
          return {
            coefficient: left.coefficient.subtract(right.coefficient),
            constant: left.constant.subtract(right.constant),
          };
        case '*':
          if (!left.coefficient.isZero() && !right.coefficient.isZero()) {
            throw nonLinear('multiplica dos términos con x.');
          }
          return {
            coefficient: left.coefficient
              .multiply(right.constant)
              .add(right.coefficient.multiply(left.constant)),
            constant: left.constant.multiply(right.constant),
          };
        case '/':
          if (!right.coefficient.isZero()) throw nonLinear('la x aparece en un divisor.');
          return {
            coefficient: left.coefficient.divide(right.constant),
            constant: left.constant.divide(right.constant),
          };
        case '^':
          if (!right.coefficient.isZero()) throw nonLinear('la x aparece en un exponente.');
          if (left.coefficient.isZero()) {
            return { coefficient: ZERO, constant: evaluatePower(left.constant, right.constant) };
          }
          if (right.constant.equals(ONE)) return left;
          throw nonLinear('eleva la x a una potencia distinta de 1.');
      }
    }
  }
}

/**
 * Solución exacta de una ecuación lineal `izquierda = derecha`. La ecuación debe tener solución ÚNICA
 * (si el coeficiente de `x` se anula, no la tiene: o ninguna o infinitas).
 *
 * @throws EquationError | DivisionByZeroError | InvalidPowerError
 */
export function solveLinearEquation(equation: ParsedEquation): Fraction {
  const left = linearize(equation.left);
  const right = linearize(equation.right);
  const coefficient = left.coefficient.subtract(right.coefficient);
  if (coefficient.isZero()) {
    throw new EquationError('NO_UNIQUE_SOLUTION', 'La ecuación no tiene una solución única para x.');
  }
  return right.constant.subtract(left.constant).divide(coefficient);
}
