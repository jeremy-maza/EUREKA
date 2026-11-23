import { WorldDefinition } from '../world.types';
import { profile } from './profiles';

const families = [
  { family: 'SIGNED' as const, weight: 1 },
  { family: 'FRACTIONAL' as const, weight: 1 },
  { family: 'DECIMAL' as const, weight: 1 },
  { family: 'POWER' as const, weight: 1 },
  { family: 'LINEAR_EQUATION' as const, weight: 2 },
];
const negatives = { negatives: true };

/** Mundo 5: Caos matemático. Todo lo anterior a la vez (decimales y potencias) y más reglas por secuencia. */
export const chaosWorld: WorldDefinition = {
  slug: 'chaos',
  name: 'Caos matemático',
  description: 'Todo lo aprendido a la vez: negativos, fracciones, decimales, potencias y ecuaciones.',
  position: 5,
  concepts: [
    'Combinar todas las operaciones',
    'Negativos, fracciones y decimales juntos',
    'Potencias y ecuaciones',
    'Planificar una respuesta con muchas reglas',
  ],
  syntax: { decimals: true, powers: true },
  rules: [
    {
      id: 'chaos.forbidden-digit-0',
      type: 'FORBIDDEN_DIGIT',
      description: 'No puedes usar el dígito 0 (tampoco en 10 ni en 0.5).',
      config: { digit: 0 },
    },
    {
      id: 'chaos.required-power',
      type: 'REQUIRED_OPERATOR',
      description: 'Usa al menos una potencia, como 2 ^ 3.',
      config: { operator: '^' },
    },
    {
      id: 'chaos.required-decimal',
      type: 'REQUIRED_DECIMAL',
      description: 'Usa al menos un número decimal, como 1.5.',
      config: {},
    },
    {
      id: 'chaos.required-negative',
      type: 'REQUIRED_NEGATIVE',
      description: 'Usa al menos un número negativo, como (-3).',
      config: {},
    },
    {
      id: 'chaos.required-parentheses',
      type: 'REQUIRED_PARENTHESES',
      description: 'Usa paréntesis que cambien el orden de las operaciones, como en (2 + 3) * 4.',
      config: {},
    },
    {
      id: 'chaos.min-numbers-4',
      type: 'MIN_NUMBERS',
      description: 'Usa al menos 4 números.',
      config: { count: 4 },
    },
    {
      id: 'chaos.max-number-12',
      type: 'MAX_NUMBER',
      description: 'Ningún número puede ser mayor que 12.',
      config: { max: 12 },
    },
  ],
  sequence: {
    ruleCount: { EASIER: 3, BASELINE: 4, HARDER: 5 },
    extraTimeSeconds: 25,
  },
  generation: {
    profiles: {
      EASIER: {
        families,
        first: profile([1, 10], [2, 2], 'PRODUCT', { ...negatives, maxResult: 150 }),
        last: profile([1, 12], [2, 3], 'MIXED', { ...negatives, maxResult: 200 }),
      },
      BASELINE: {
        families,
        first: profile([1, 12], [2, 3], 'MIXED', { ...negatives, maxResult: 200 }),
        last: profile([2, 15], [2, 3], 'NESTED', { ...negatives, maxResult: 400 }),
      },
      HARDER: {
        families,
        first: profile([2, 12], [2, 3], 'MIXED', { ...negatives, maxResult: 300 }),
        last: profile([2, 20], [3, 4], 'NESTED', { negatives: true, fractions: true, maxResult: 600 }),
      },
    },
  },
};
