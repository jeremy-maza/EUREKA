import { BinaryOperator, collectNodes } from '../../math';
import { RuleConfig, RuleHandler } from '../rule.types';
import { OPERATOR_NAMES, parseOperator } from './operator-names';

export const REQUIRED_OPERATOR = 'REQUIRED_OPERATOR';

export interface RequiredOperatorConfig {
  operator: BinaryOperator;
}

/**
 * "Debes usar al menos una división": la expresión debe contener una operación binaria con ese operador
 * (con cualquier operando). El menos unario de `-3` no es una resta.
 */
export const requiredOperatorRule: RuleHandler<RequiredOperatorConfig> = {
  type: REQUIRED_OPERATOR,

  parseConfig(raw: RuleConfig): RequiredOperatorConfig {
    return { operator: parseOperator(REQUIRED_OPERATOR, raw) };
  },

  check({ operator }, { expression }) {
    const found = collectNodes(expression).some(
      (node) => node.kind === 'binary' && node.operator === operator,
    );
    if (found) return null;
    const hint = operator === '-' ? ' El signo de un número negativo, como en -3, no es una resta.' : '';
    return `Debes usar al menos una ${OPERATOR_NAMES[operator]} (${operator}).${hint}`;
  },
};
