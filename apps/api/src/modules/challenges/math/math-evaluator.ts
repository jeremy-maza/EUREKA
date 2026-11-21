import { ExpressionNode } from './ast';
import { Fraction } from './fraction';

/**
 * Evalúa un AST con aritmética racional exacta. Es una función pura del árbol:
 * no usa `eval`, `Function` ni el texto original del jugador.
 */
export class MathEvaluator {
  /** @throws DivisionByZeroError cuando algún divisor vale cero. */
  evaluate(node: ExpressionNode): Fraction {
    switch (node.kind) {
      case 'number':
        return Fraction.of(node.value);
      case 'negation':
        return this.evaluate(node.operand).negate();
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
        }
      }
    }
  }
}
