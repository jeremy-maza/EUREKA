import { WorldDefinition } from '../world.types';
import { profile } from './profiles';

/** Mundo 4: Álgebra. Ecuaciones lineales (se responde con una expresión que vale `x`) y potencias. */
export const algebraWorld: WorldDefinition = {
  slug: 'algebra',
  name: 'Álgebra',
  description: 'Ecuaciones y potencias: encuentra x y escríbela respetando las reglas.',
  position: 4,
  concepts: [
    'Resolver ecuaciones lineales',
    'Potencias de exponente entero',
    'Paréntesis y jerarquía de las operaciones',
  ],
  syntax: { decimals: false, powers: true },
  rules: [
    {
      id: 'algebra.required-power',
      type: 'REQUIRED_OPERATOR',
      description: 'Usa al menos una potencia, como 2 ^ 3.',
      config: { operator: '^' },
    },
    {
      id: 'algebra.required-parentheses',
      type: 'REQUIRED_PARENTHESES',
      description: 'Usa paréntesis que cambien el orden de las operaciones, como en (2 + 3) * 4.',
      config: {},
    },
    {
      id: 'algebra.max-number-9',
      type: 'MAX_NUMBER',
      description: 'Usa solo números de una cifra (ninguno mayor que 9).',
      config: { max: 9 },
    },
    {
      id: 'algebra.forbidden-digit-1',
      type: 'FORBIDDEN_DIGIT',
      description: 'No puedes usar el dígito 1.',
      config: { digit: 1 },
    },
    {
      id: 'algebra.min-numbers-3',
      type: 'MIN_NUMBERS',
      description: 'Usa al menos 3 números.',
      config: { count: 3 },
    },
  ],
  sequence: {
    ruleCount: { EASIER: 2, BASELINE: 3, HARDER: 4 },
    extraTimeSeconds: 20,
  },
  generation: {
    profiles: {
      EASIER: {
        families: [
          { family: 'LINEAR_EQUATION', weight: 1 },
          { family: 'POWER', weight: 1 },
        ],
        first: profile([1, 10], [2, 2], 'PRODUCT', { maxResult: 100 }),
        last: profile([1, 12], [2, 3], 'MIXED', { maxResult: 150 }),
      },
      BASELINE: {
        families: [
          { family: 'LINEAR_EQUATION', weight: 2 },
          { family: 'POWER', weight: 1 },
        ],
        first: profile([1, 12], [2, 3], 'PRODUCT', { maxResult: 150 }),
        last: profile([2, 15], [2, 3], 'NESTED', { maxResult: 300 }),
      },
      HARDER: {
        families: [
          { family: 'LINEAR_EQUATION', weight: 2 },
          { family: 'POWER', weight: 1 },
        ],
        first: profile([2, 12], [2, 3], 'MIXED', { maxResult: 200 }),
        last: profile([2, 20], [3, 3], 'NESTED', { negatives: true, maxResult: 400 }),
      },
    },
  },
};
