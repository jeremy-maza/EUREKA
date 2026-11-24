import { BinaryOperator, collectNodes } from '../../math';
import { RuleConfig, RuleHandler } from '../rule.types';
import { OPERATOR_NAMES, parseOperator } from './operator-names';

export const FORBIDDEN_OPERATOR = 'FORBIDDEN_OPERATOR';

export interface ForbiddenOperatorConfig {
  operator: BinaryOperator;
}

/**
 * "No puedes restar": ninguna operación binaria puede usar ese operador. El menos unario (`-3`, `5 + (-3)`)
 * NO es una resta y sigue permitido.
 *
 * Nota de diseño: por sí sola esta regla nunca rechaza el resultado escrito como literal (un literal no
 * tiene operadores), así que no "muerde" como única regla activa y los catálogos no la usan (ver §9).
 */
export const forbiddenOperatorRule: RuleHandler<ForbiddenOperatorConfig> = {
  type: FORBIDDEN_OPERATOR,

  parseConfig(raw: RuleConfig): ForbiddenOperatorConfig {
    return { operator: parseOperator(FORBIDDEN_OPERATOR, raw) };
  },

  check({ operator }, { expression }) {
    const found = collectNodes(expression).some(
      (node) => node.kind === 'binary' && node.operator === operator,
    );
    if (!found) return null;
    const hint = operator === '-' ? ' Los números negativos, como en 5 + (-3), sí están permitidos.' : '';
    return `No puedes usar la ${OPERATOR_NAMES[operator]} (${operator}), pero tu expresión la usa.${hint}`;
  },
};
