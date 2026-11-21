import { collectNumbers } from '../../math';
import { InvalidRuleConfigError } from '../rule.errors';
import { RuleConfig, RuleHandler } from '../rule.types';

export const FORBIDDEN_DIGIT = 'FORBIDDEN_DIGIT';

export interface ForbiddenDigitConfig {
  /** Dígito (0-9) que no puede aparecer en ningún número escrito de la expresión. */
  digit: number;
}

/** "El dígito 2 no se puede usar": ningún literal de la expresión puede contenerlo. */
export const forbiddenDigitRule: RuleHandler<ForbiddenDigitConfig> = {
  type: FORBIDDEN_DIGIT,

  parseConfig(raw: RuleConfig): ForbiddenDigitConfig {
    const { digit } = raw;
    if (typeof digit !== 'number' || !Number.isInteger(digit) || digit < 0 || digit > 9) {
      throw new InvalidRuleConfigError(FORBIDDEN_DIGIT, '"digit" debe ser un entero entre 0 y 9.');
    }
    return { digit };
  },

  check({ digit }, { expression }) {
    const offending = collectNumbers(expression).find((node) => node.text.includes(String(digit)));
    return offending
      ? `No puedes usar el dígito ${digit}, pero aparece en el número ${offending.text}.`
      : null;
  },
};
