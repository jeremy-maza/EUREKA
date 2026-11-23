import { WorldDefinition } from '../world.types';
import { profile } from './profiles';

const families = [
  { family: 'SIGNED' as const, weight: 3 },
  { family: 'MULTIPLICATIVE' as const, weight: 1 },
];
const signed = { negatives: true };

/** Mundo 2: Números y signos. Enteros con signo; construye sobre la aritmética del Mundo 1. */
export const signsWorld: WorldDefinition = {
  slug: 'signs',
  name: 'Números y signos',
  description: 'Números negativos y la regla de los signos: llega al mismo resultado por otro camino.',
  position: 2,
  concepts: [
    'Números negativos',
    'Regla de los signos en la multiplicación',
    'Restar es sumar el opuesto',
    'Descomponer con números pequeños',
  ],
  syntax: { decimals: false, powers: false },
  rules: [
    {
      id: 'signs.required-negative',
      type: 'REQUIRED_NEGATIVE',
      description: 'Usa al menos un número negativo, como (-3).',
      config: {},
    },
    {
      id: 'signs.forbidden-digit-3',
      type: 'FORBIDDEN_DIGIT',
      description: 'No puedes usar el dígito 3.',
      config: { digit: 3 },
    },
    {
      id: 'signs.max-number-10',
      type: 'MAX_NUMBER',
      description: 'Ningún número puede ser mayor que 10.',
      config: { max: 10 },
    },
    {
      id: 'signs.required-multiplication',
      type: 'REQUIRED_OPERATOR',
      description: 'Debes usar al menos una multiplicación.',
      config: { operator: '*' },
    },
    {
      id: 'signs.required-subtraction',
      type: 'REQUIRED_OPERATOR',
      description: 'Debes usar al menos una resta (el signo de un número negativo no cuenta).',
      config: { operator: '-' },
    },
  ],
  sequence: {
    ruleCount: { EASIER: 2, BASELINE: 3, HARDER: 4 },
    extraTimeSeconds: 5,
  },
  generation: {
    profiles: {
      EASIER: {
        families,
        first: profile([1, 12], [2, 2], 'PRODUCT', { ...signed, maxResult: 100 }),
        last: profile([1, 15], [2, 3], 'MIXED', { ...signed, maxResult: 150 }),
      },
      BASELINE: {
        families,
        first: profile([1, 12], [2, 3], 'PRODUCT', { ...signed, maxResult: 120 }),
        last: profile([2, 20], [2, 3], 'NESTED', { ...signed, maxResult: 300 }),
      },
      HARDER: {
        families,
        first: profile([2, 15], [2, 3], 'MIXED', { ...signed, maxResult: 150 }),
        last: profile([2, 25], [3, 4], 'NESTED', { ...signed, maxResult: 500 }),
      },
    },
  },
};
