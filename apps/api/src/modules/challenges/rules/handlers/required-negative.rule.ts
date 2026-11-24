import { MathError, MathEvaluator, collectNodes } from '../../math';
import { RuleConfig, RuleHandler } from '../rule.types';
import { parseEmptyConfig } from './operator-names';

export const REQUIRED_NEGATIVE = 'REQUIRED_NEGATIVE';

const evaluator = new MathEvaluator();

/** `true` si el nodo de negación vale realmente menos que cero (`-0` o `-(3 - 3)` no son números negativos). */
function isNegativeValue(node: Parameters<MathEvaluator['evaluate']>[0]): boolean {
  try {
    return evaluator.evaluate(node).numerator < 0n;
  } catch (error) {
    if (error instanceof MathError) return false; // p. ej. división entre cero: no cuenta como negativo
    throw error;
  }
}

/**
 * "Usa al menos un número negativo": la expresión debe contener un menos unario cuyo valor sea negativo (`-3`,
 * `5 * (-2)`, `-(4 + 1)`; también `-(-5)`, que contiene el negativo `-5`). `-0` no cuenta.
 */
export const requiredNegativeRule: RuleHandler<Record<string, never>> = {
  type: REQUIRED_NEGATIVE,

  parseConfig(raw: RuleConfig) {
    return parseEmptyConfig(REQUIRED_NEGATIVE, raw);
  },

  check(_config, { expression }) {
    return collectNodes(expression).some((node) => node.kind === 'negation' && isNegativeValue(node))
      ? null
      : 'Debes usar al menos un número negativo, por ejemplo (-3). Restar (5 - 3) no cuenta.';
  },
};
