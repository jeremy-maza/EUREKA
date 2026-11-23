import { WorldDefinition } from '../world.types';
import { profile } from './profiles';

const families = [
  { family: 'FRACTIONAL' as const, weight: 1 },
  { family: 'DECIMAL' as const, weight: 1 },
];

/** Mundo 3: Fracciones y decimales. Activa los decimales exactos (`2.5` ≡ `5/2`). */
export const fractionsWorld: WorldDefinition = {
  slug: 'fractions',
  name: 'Fracciones y decimales',
  description: 'Fracciones y decimales exactos: el mismo número se puede escribir de muchas maneras.',
  position: 3,
  concepts: ['Operaciones con fracciones', 'Decimales exactos', 'Equivalencia entre fracciones y decimales'],
  syntax: { decimals: true, powers: false },
  rules: [
    {
      id: 'fractions.required-decimal',
      type: 'REQUIRED_DECIMAL',
      description: 'Usa al menos un número decimal, como 0.5.',
      config: {},
    },
    {
      id: 'fractions.required-division',
      type: 'REQUIRED_OPERATOR',
      description: 'Usa al menos una división (una fracción como 3 / 4 cuenta).',
      config: { operator: '/' },
    },
    {
      id: 'fractions.forbidden-digit-5',
      type: 'FORBIDDEN_DIGIT',
      description: 'No puedes usar el dígito 5 (tampoco en decimales como 0.5).',
      config: { digit: 5 },
    },
    {
      id: 'fractions.min-numbers-3',
      type: 'MIN_NUMBERS',
      description: 'Usa al menos 3 números.',
      config: { count: 3 },
    },
    {
      id: 'fractions.max-number-10',
      type: 'MAX_NUMBER',
      description: 'No escribas números mayores que 10 (el signo no cuenta: en -12 escribes un 12).',
      config: { max: 10 },
    },
  ],
  sequence: {
    ruleCount: { EASIER: 2, BASELINE: 3, HARDER: 4 },
    extraTimeSeconds: 10,
  },
  generation: {
    profiles: {
      EASIER: {
        families,
        first: profile([1, 9], [2, 2], 'PRODUCT', { maxResult: 50 }),
        last: profile([1, 12], [2, 2], 'MIXED', { maxResult: 100 }),
      },
      BASELINE: {
        families,
        first: profile([1, 10], [2, 2], 'PRODUCT', { maxResult: 60 }),
        last: profile([1, 15], [2, 3], 'MIXED', { maxResult: 150 }),
      },
      HARDER: {
        families,
        first: profile([1, 12], [2, 3], 'MIXED', { maxResult: 100 }),
        last: profile([2, 20], [2, 3], 'NESTED', { maxResult: 200 }),
      },
    },
  },
};
