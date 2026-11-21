import { WorldDefinition } from '../world.types';

/**
 * Mundo 1: Aritmética. Secuencia determinista de prueba basada en los ejemplos del enunciado.
 *
 * Reglas acumuladas por reto:
 *   #1 `3 * 7`           → sin regla nueva
 *   #2 `3 * 7 * 2`       → no se puede usar el dígito 2
 *   #3 `3 * 7 * 2 / 6`   → debe usarse la multiplicación 7 * 1
 *   #4 `5 * 8`           → no se puede usar el dígito 5
 *
 * `referenceSolution` cumple las CUATRO reglas a la vez (garantiza que el reto sigue siendo resoluble
 * aunque el jugador reinicie la secuencia con todas las reglas ya desbloqueadas).
 */
export const arithmeticWorld: WorldDefinition = {
  slug: 'arithmetic',
  name: 'Aritmética',
  description: 'Suma, resta, multiplicación y división bajo reglas que se van acumulando.',
  position: 1,
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
  ],
  challenges: [
    {
      id: 'arithmetic-001',
      position: 1,
      expression: '3 * 7',
      expectedResult: '21',
      introducesRuleId: null,
      referenceSolution: '7 * 1 * 3',
    },
    {
      id: 'arithmetic-002',
      position: 2,
      expression: '3 * 7 * 2',
      expectedResult: '42',
      introducesRuleId: 'arithmetic.forbidden-digit-2',
      referenceSolution: '7 * 1 * 6',
    },
    {
      id: 'arithmetic-003',
      position: 3,
      expression: '3 * 7 * 2 / 6',
      expectedResult: '7',
      introducesRuleId: 'arithmetic.required-7-times-1',
      referenceSolution: '7 * 1',
    },
    {
      id: 'arithmetic-004',
      position: 4,
      expression: '5 * 8',
      expectedResult: '40',
      introducesRuleId: 'arithmetic.forbidden-digit-5',
      referenceSolution: '7 * 1 * 4 + 3 * 4',
    },
  ],
};
