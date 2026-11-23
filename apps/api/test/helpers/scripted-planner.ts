import { RuleDefinition } from '../../src/modules/challenges';
import { PlanSequenceInput, SequencePlan, planSequence } from '../../src/modules/sequences';
import { WorldDefinition } from '../../src/modules/worlds/world.types';

export const RULE_NO_2 = 'arithmetic.forbidden-digit-2';
export const RULE_7X1 = 'arithmetic.required-7-times-1';
export const RULE_NO_5 = 'arithmetic.forbidden-digit-5';

/**
 * Secuencia "clásica" del Mundo 1 (la del enunciado original): reglas no-2 → 7*1 → no-5. Las soluciones de
 * referencia cumplen las tres reglas a la vez. Sirve para probar la mecánica con valores exactos.
 */
export const CLASSIC = [
  { expression: '3 * 7', expectedResult: '21', rule: null, solution: '7 * 1 * 3' },
  { expression: '3 * 7 * 2', expectedResult: '42', rule: RULE_NO_2, solution: '7 * 1 * 6' },
  { expression: '3 * 7 * 2 / 6', expectedResult: '7', rule: RULE_7X1, solution: '7 * 1' },
  { expression: '5 * 8', expectedResult: '40', rule: RULE_NO_5, solution: '7 * 1 * 4 + 3 * 4' },
] as const;

export const CLASSIC_SOLUTIONS = CLASSIC.map((c) => c.solution);

/** Plan clásico (ignora semilla y dificultad, que sí se guardan en la secuencia). */
export function classicPlan(world: WorldDefinition, input: PlanSequenceInput): SequencePlan {
  const ids = new Set(world.rules.map((rule: RuleDefinition) => rule.id));
  for (const key of [RULE_NO_2, RULE_7X1, RULE_NO_5]) {
    if (!ids.has(key)) throw new Error(`El repertorio de "${world.slug}" ya no contiene ${key}.`);
  }
  return {
    worldSlug: world.slug,
    seed: input.seed,
    difficulty: input.difficulty,
    ruleIds: [RULE_NO_2, RULE_7X1, RULE_NO_5],
    generatorVersion: 'test-classic',
    challenges: CLASSIC.map((c, index) => ({
      id: `classic-${index + 1}`,
      position: index + 1,
      expression: c.expression,
      expectedResult: c.expectedResult,
      introducesRuleId: c.rule,
      referenceSolution: c.solution,
      statementKind: 'EXPRESSION',
      generation: {
        fingerprint: `classic-${index + 1}`,
        generatorVersion: 'test-classic',
        templateId: 'CLASSIC',
        seed: input.seed,
      },
    })),
  };
}

export type PlannerMode = 'classic-arithmetic' | 'real';

/** Planificador de pruebas: clásico para `arithmetic` (si se pide) y el real para el resto de mundos. */
export function testPlanner(mode: PlannerMode): typeof planSequence {
  if (mode === 'real') return planSequence;
  return (world, input) =>
    world.slug === 'arithmetic' ? classicPlan(world, input) : planSequence(world, input);
}
