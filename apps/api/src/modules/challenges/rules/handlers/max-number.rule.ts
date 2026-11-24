import { Fraction, collectNumbers, numberValue } from '../../math';
import { RuleConfig, RuleHandler } from '../rule.types';
import { parseIntegerField } from './operator-names';

export const MAX_NUMBER = 'MAX_NUMBER';

export const MAX_NUMBER_LIMIT = 1_000_000;

export interface MaxNumberConfig {
  /** Ningún número escrito puede valer más que esto (entero ≥ 1). */
  max: number;
}

/**
 * "Ningún número puede ser mayor que 10": cada literal escrito vale como mucho `max` (`-12` contiene el
 * literal 12). Obliga a descomponer: 42 → `6 * 7`.
 */
export const maxNumberRule: RuleHandler<MaxNumberConfig> = {
  type: MAX_NUMBER,

  parseConfig(raw: RuleConfig): MaxNumberConfig {
    return { max: parseIntegerField(MAX_NUMBER, raw, 'max', 1, MAX_NUMBER_LIMIT) };
  },

  check({ max }, { expression }) {
    const limit = Fraction.of(max);
    const offending = collectNumbers(expression).find((node) => numberValue(node).compare(limit) > 0);
    return offending
      ? `No puedes escribir números mayores que ${max}, pero escribiste el ${offending.text}.`
      : null;
  },
};
