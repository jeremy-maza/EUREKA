import { WorldDefinition } from '../world.types';
import { profile } from './profiles';

const families = [{ family: 'MULTIPLICATIVE' as const, weight: 1 }];

/**
 * Mundo 1: Aritmética. Enteros y las cuatro operaciones (sin decimales ni potencias).
 *
 * Las TRES primeras reglas son las del catálogo original (sus ids, tipos y configuraciones no cambian: hay
 * filas en la BD e historial que las referencian). Cada secuencia sortea un subconjunto y un orden.
 */
export const arithmeticWorld: WorldDefinition = {
  slug: 'arithmetic',
  name: 'Aritmética',
  description: 'Suma, resta, multiplicación y división bajo reglas que se van acumulando.',
  position: 1,
  concepts: [
    'Las cuatro operaciones',
    'Jerarquía de las operaciones',
    'Descomponer un número de varias formas',
    'Paréntesis que cambian el orden',
  ],
  syntax: { decimals: false, powers: false },
  rules: [
    {
      id: 'arithmetic.forbidden-digit-2',
      type: 'FORBIDDEN_DIGIT',
      description: 'No puedes usar el dígito 2.',
      config: { digit: 2 },
    },
    {
      id: 'arithmetic.required-7-times-1',
      type: 'REQUIRED_OPERATION',
      description: 'Debes usar la multiplicación 7 * 1.',
      config: { operator: '*', left: 7, right: 1 },
    },
    {
      id: 'arithmetic.forbidden-digit-5',
      type: 'FORBIDDEN_DIGIT',
      description: 'No puedes usar el dígito 5.',
      config: { digit: 5 },
    },
    {
      id: 'arithmetic.required-division',
      type: 'REQUIRED_OPERATOR',
      description: 'Debes usar al menos una división.',
      config: { operator: '/' },
    },
    {
      id: 'arithmetic.required-parentheses',
      type: 'REQUIRED_PARENTHESES',
      description: 'Usa paréntesis que cambien el orden de las operaciones, como en (2 + 3) * 4.',
      config: {},
    },
    {
      id: 'arithmetic.min-numbers-4',
      type: 'MIN_NUMBERS',
      description: 'Usa al menos 4 números.',
      config: { count: 4 },
    },
  ],
  sequence: {
    ruleCount: { EASIER: 2, BASELINE: 3, HARDER: 4 },
    extraTimeSeconds: 0,
  },
  generation: {
    profiles: {
      EASIER: {
        families,
        first: profile([2, 9], [2, 2], 'PRODUCT', { maxResult: 100 }),
        last: profile([2, 12], [2, 3], 'MIXED', { maxResult: 150 }),
      },
      BASELINE: {
        families,
        first: profile([2, 10], [2, 3], 'PRODUCT', { maxResult: 120 }),
        last: profile([2, 15], [3, 4], 'NESTED', { maxResult: 400 }),
      },
      HARDER: {
        families,
        first: profile([2, 12], [2, 3], 'MIXED', { maxResult: 200 }),
        last: profile([3, 20], [3, 4], 'NESTED', { maxResult: 800 }),
      },
    },
  },
};
