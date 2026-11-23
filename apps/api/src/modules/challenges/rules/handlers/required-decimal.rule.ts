import { collectNumbers, isDecimalLiteral, numberValue } from '../../math';
import { RuleConfig, RuleHandler } from '../rule.types';
import { parseEmptyConfig } from './operator-names';

export const REQUIRED_DECIMAL = 'REQUIRED_DECIMAL';

/**
 * "Usa al menos un número decimal": algún literal escrito con separador decimal y parte decimal no nula
 * (`0.5`, `2,25`). `3.0` no cuenta: vale un entero y la regla dejaría de enseñar nada.
 * Solo tiene sentido en mundos con `MathSyntax.decimals`.
 */
export const requiredDecimalRule: RuleHandler<Record<string, never>> = {
  type: REQUIRED_DECIMAL,

  parseConfig(raw: RuleConfig) {
    return parseEmptyConfig(REQUIRED_DECIMAL, raw);
  },

  check(_config, { expression }) {
    const decimals = collectNumbers(expression).filter(isDecimalLiteral);
    if (decimals.some((node) => !numberValue(node).isInteger())) return null;
    const whole = decimals[0];
    return whole
      ? `Debes usar al menos un número decimal con parte decimal, por ejemplo 0.5 (${whole.text} vale un entero y no cuenta).`
      : 'Debes usar al menos un número decimal, por ejemplo 0.5.';
  },
};
