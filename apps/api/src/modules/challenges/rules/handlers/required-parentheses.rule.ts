import { necessaryGroups } from '../../math';
import { RuleConfig, RuleHandler } from '../rule.types';
import { parseEmptyConfig } from './operator-names';

export const REQUIRED_PARENTHESES = 'REQUIRED_PARENTHESES';

/**
 * "Usa paréntesis que cambien el orden de las operaciones": debe haber unos paréntesis NECESARIOS, es decir,
 * que no se puedan quitar sin cambiar la estructura de la expresión: `(2 + 3) * 4`, `10 - (3 + 2)`,
 * `-(4 + 1)`, `(-2) ^ 2`. Unos paréntesis de adorno, como en `(7) * 3` o `(2 * 3) + 4`, no cuentan.
 */
export const requiredParenthesesRule: RuleHandler<Record<string, never>> = {
  type: REQUIRED_PARENTHESES,

  parseConfig(raw: RuleConfig) {
    return parseEmptyConfig(REQUIRED_PARENTHESES, raw);
  },

  check(_config, { expression }) {
    return necessaryGroups(expression).length > 0
      ? null
      : 'Debes usar paréntesis que cambien el orden de las operaciones, como en (2 + 3) * 4. ' +
          'Unos paréntesis que se pueden quitar sin cambiar nada no cuentan.';
  },
};
