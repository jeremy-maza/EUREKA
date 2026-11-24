import { RuleDefinition } from '../../challenges';
import { WorldDefinition } from '../../worlds/world.types';
import { PlayableSequence } from '../progression.types';

/** Reglas de la secuencia clásica del Mundo 1 (mismos ids y configuración que el catálogo). */
export const CLASSIC_RULES: readonly RuleDefinition[] = [
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
];

/** Secuencia clásica (`3 * 7` → `3 * 7 * 2` → `3 * 7 * 2 / 6` → `5 * 8`), fija para pruebas del motor puro. */
export const CLASSIC_SEQUENCE: PlayableSequence = {
  worldSlug: 'arithmetic',
  rules: CLASSIC_RULES,
  challenges: [
    {
      id: 'c1',
      position: 1,
      expression: '3 * 7',
      expectedResult: '21',
      introducesRuleId: null,
      referenceSolution: '7 * 1 * 3',
    },
    {
      id: 'c2',
      position: 2,
      expression: '3 * 7 * 2',
      expectedResult: '42',
      introducesRuleId: CLASSIC_RULES[0].id,
      referenceSolution: '7 * 1 * 6',
    },
    {
      id: 'c3',
      position: 3,
      expression: '3 * 7 * 2 / 6',
      expectedResult: '7',
      introducesRuleId: CLASSIC_RULES[1].id,
      referenceSolution: '7 * 1',
    },
    {
      id: 'c4',
      position: 4,
      expression: '5 * 8',
      expectedResult: '40',
      introducesRuleId: CLASSIC_RULES[2].id,
      referenceSolution: '7 * 1 * 4 + 3 * 4',
    },
  ],
};

/** Mundo mínimo para el motor puro: solo usa `syntax` y `sequence.extraTimeSeconds`. */
export const CLASSIC_WORLD = {
  slug: 'arithmetic',
  name: 'Aritmética',
  description: '',
  position: 1,
  concepts: [],
  rules: CLASSIC_RULES,
  syntax: { decimals: false, powers: false },
  sequence: { ruleCount: { EASIER: 2, BASELINE: 3, HARDER: 3 }, extraTimeSeconds: 0 },
  generation: { profiles: { EASIER: {}, BASELINE: {}, HARDER: {} } },
} as unknown as WorldDefinition;
