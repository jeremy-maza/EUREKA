import { collectNumbers } from '../../math';
import { RuleConfig, RuleHandler } from '../rule.types';
import { parseIntegerField } from './operator-names';

export const MIN_NUMBERS = 'MIN_NUMBERS';

/** Mayor `count` admitido (una respuesta tiene como mucho 200 caracteres). */
export const MAX_MIN_NUMBERS = 20;

export interface MinNumbersConfig {
  /** Cantidad mínima de números escritos (literales) en la expresión. */
  count: number;
}

/** "Usa al menos 4 números": cuenta los literales escritos (`7 * 1 * 3` tiene 3; `-3` tiene 1). */
export const minNumbersRule: RuleHandler<MinNumbersConfig> = {
  type: MIN_NUMBERS,

  parseConfig(raw: RuleConfig): MinNumbersConfig {
    return { count: parseIntegerField(MIN_NUMBERS, raw, 'count', 2, MAX_MIN_NUMBERS) };
  },

  check({ count }, { expression }) {
    const used = collectNumbers(expression).length;
    return used >= count
      ? null
      : `Debes usar al menos ${count} números, pero tu expresión tiene ${used === 1 ? '1 número' : `${used} números`}.`;
  },
};
