import {
  BINARY_OPERATORS,
  BinaryOperator,
  ExpressionNode,
  Fraction,
  collectNodes,
  isCommutative,
  numberValue,
} from '../../math';
import { InvalidRuleConfigError } from '../rule.errors';
import { RuleConfig, RuleHandler } from '../rule.types';

export const REQUIRED_OPERATION = 'REQUIRED_OPERATION';

export interface RequiredOperationConfig {
  operator: BinaryOperator;
  left: number;
  right: number;
}

/** Literal con ese valor (por valor: `07` y, en mundos con decimales, `7.0` cuentan como 7). */
function isLiteral(node: ExpressionNode, value: number): boolean {
  return node.kind === 'number' && numberValue(node).equals(Fraction.of(value));
}

/**
 * "Debes usar la multiplicación 7 * 1": debe existir una operación binaria con ese operador
 * cuyos dos operandos sean *literales* con esos valores. En `+` y `*` el orden de los operandos
 * no importa (7 * 1 ≡ 1 * 7); en `-` y `/` sí.
 *
 * Limitación conocida: opera sobre el árbol tal como se escribió; `2 * 7 * 1` se interpreta como
 * `(2 * 7) * 1` y NO contiene `7 * 1`.
 */
export const requiredOperationRule: RuleHandler<RequiredOperationConfig> = {
  type: REQUIRED_OPERATION,

  parseConfig(raw: RuleConfig): RequiredOperationConfig {
    const { operator, left, right } = raw;
    if (typeof operator !== 'string' || !BINARY_OPERATORS.includes(operator as BinaryOperator)) {
      throw new InvalidRuleConfigError(
        REQUIRED_OPERATION,
        `"operator" debe ser uno de ${BINARY_OPERATORS.join(' ')}.`,
      );
    }
    for (const [name, operand] of [
      ['left', left],
      ['right', right],
    ] as const) {
      if (typeof operand !== 'number' || !Number.isSafeInteger(operand) || operand < 0) {
        throw new InvalidRuleConfigError(REQUIRED_OPERATION, `"${name}" debe ser un entero no negativo.`);
      }
    }
    return { operator: operator as BinaryOperator, left: left as number, right: right as number };
  },

  check({ operator, left, right }, { expression }) {
    const found = collectNodes(expression).some((node) => {
      if (node.kind !== 'binary' || node.operator !== operator) return false;
      const inOrder = isLiteral(node.left, left) && isLiteral(node.right, right);
      const swapped = isLiteral(node.left, right) && isLiteral(node.right, left);
      return inOrder || (isCommutative(operator) && swapped);
    });
    return found ? null : `Debes usar la operación ${left} ${operator} ${right} al menos una vez.`;
  },
};
