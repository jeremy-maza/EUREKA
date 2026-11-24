import { BINARY_OPERATORS, BinaryOperator } from '../../math';
import { InvalidRuleConfigError } from '../rule.errors';
import { RuleConfig } from '../rule.types';

/** Nombre en español de cada operación (para descripciones y mensajes). */
export const OPERATOR_NAMES: Readonly<Record<BinaryOperator, string>> = {
  '+': 'suma',
  '-': 'resta',
  '*': 'multiplicación',
  '/': 'división',
  '^': 'potencia',
};

export function parseOperator(ruleType: string, raw: RuleConfig): BinaryOperator {
  const { operator } = raw;
  if (typeof operator !== 'string' || !BINARY_OPERATORS.includes(operator as BinaryOperator)) {
    throw new InvalidRuleConfigError(ruleType, `"operator" debe ser uno de ${BINARY_OPERATORS.join(' ')}.`);
  }
  return operator as BinaryOperator;
}

/** Reglas sin parámetros: la configuración debe ser `{}`. */
export function parseEmptyConfig(ruleType: string, raw: RuleConfig): Record<string, never> {
  if (typeof raw !== 'object' || raw === null || Object.keys(raw).length > 0) {
    throw new InvalidRuleConfigError(ruleType, 'esta regla no admite parámetros (config: {}).');
  }
  return {};
}

export function parseIntegerField(
  ruleType: string,
  raw: RuleConfig,
  field: string,
  min: number,
  max: number,
): number {
  const value = raw[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new InvalidRuleConfigError(ruleType, `"${field}" debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}
