import { collectNodes } from '../../math';
import { RuleConfig, RuleHandler } from '../rule.types';
import { parseEmptyConfig } from './operator-names';

export const REQUIRED_NEGATIVE = 'REQUIRED_NEGATIVE';

/** "Usa al menos un número negativo": la expresión debe contener un menos unario (`-3`, `5 * (-2)`, `-(4 + 1)`). */
export const requiredNegativeRule: RuleHandler<Record<string, never>> = {
  type: REQUIRED_NEGATIVE,

  parseConfig(raw: RuleConfig) {
    return parseEmptyConfig(REQUIRED_NEGATIVE, raw);
  },

  check(_config, { expression }) {
    return collectNodes(expression).some((node) => node.kind === 'negation')
      ? null
      : 'Debes usar al menos un número negativo, por ejemplo (-3). Restar (5 - 3) no cuenta.';
  },
};
