import {
  CHALLENGE_GENERATOR_VERSION,
  ChallengeDefinition,
  MathSyntax,
  RuleDefinition,
  createChallengeEngine,
  createDefaultRuleEngine,
  resultForms,
} from '../challenges';
import { ALL_WORLDS } from '../worlds/catalog';
import { arithmeticWorld } from '../worlds/catalog/arithmetic.world';
import { DIFFICULTY_LEVELS, DifficultyLevel, WorldDefinition } from '../worlds/world.types';
import { planSequence, planSequenceForRules } from './sequence-planner';
import { MAX_SEQUENCE_SEED, SequencePlan, SequencePlanningError } from './sequence.types';

const ruleEngine = createDefaultRuleEngine();
const challengeEngine = createChallengeEngine(ruleEngine);
const PROPERTY_SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 1);

function rulesOf(world: WorldDefinition, ids: readonly string[]): RuleDefinition[] {
  return ids.map((id) => {
    const rule = world.rules.find((r) => r.id === id);
    if (!rule) throw new Error(`Regla ${id} fuera del mundo ${world.slug}`);
    return rule;
  });
}

/** El reto muerde: el enunciado (si es una expresión) y TODAS las escrituras del resultado son rechazados por reglas. */
function expectBinding(challenge: ChallengeDefinition, rules: RuleDefinition[], syntax: MathSyntax): void {
  const value = challengeEngine.statementValue(challenge, syntax);
  const submissions = [
    ...(challenge.statementKind === 'EQUATION' ? [] : [challenge.expression]),
    ...resultForms(value, syntax),
  ];
  for (const submission of submissions) {
    const evaluation = challengeEngine.evaluateSubmission({
      challenge,
      activeRules: rules,
      submission,
      syntax,
    });
    if (evaluation.failureReason !== 'RULE_VIOLATION') {
      throw new Error(
        `El reto "${challenge.expression}" no muerde con "${submission}" (${evaluation.failureReason}).`,
      );
    }
  }
}

/** Comprobación INDEPENDIENTE del planificador sobre un plan devuelto. */
function expectSoundPlan(
  world: WorldDefinition,
  plan: SequencePlan,
  difficulty: DifficultyLevel,
  seed: number,
): void {
  const k = world.sequence.ruleCount[difficulty];
  expect(plan).toMatchObject({
    worldSlug: world.slug,
    seed,
    difficulty,
    generatorVersion: CHALLENGE_GENERATOR_VERSION,
  });
  expect(plan.ruleIds).toHaveLength(k);
  expect(new Set(plan.ruleIds).size).toBe(k);
  expect(plan.challenges).toHaveLength(k + 1);
  expect(new Set(plan.challenges.map((c) => c.generation.fingerprint)).size).toBe(k + 1);

  plan.challenges.forEach((challenge, index) => {
    const active = rulesOf(world, plan.ruleIds.slice(0, index));
    expect(challenge.position).toBe(index + 1);
    expect(challenge.introducesRuleId).toBe(index === 0 ? null : plan.ruleIds[index - 1]);
    expect(['EXPRESSION', 'EQUATION']).toContain(challenge.statementKind);
    expect(Number.isSafeInteger(challenge.generation.seed)).toBe(true);
    expect(challenge.generation.seed).toBeGreaterThanOrEqual(0);
    expect(challenge.generation.seed).toBeLessThanOrEqual(MAX_SEQUENCE_SEED);
    const report = challengeEngine.verifySolvable(challenge, active, world.syntax);
    if (!report.solvable)
      throw new Error(`${world.slug}/${difficulty}/${seed} reto ${index + 1}: ${report.reason}`);
    if (index > 0) expectBinding(challenge, active, world.syntax);
  });
}

describe.each(ALL_WORLDS.map((world) => [world.slug, world] as const))(
  'planSequence — %s',
  (_slug, world) => {
    it.each(DIFFICULTY_LEVELS)(
      `%s: ${PROPERTY_SEEDS.length} semillas ⇒ planes válidos, verificados y que muerden`,
      (difficulty) => {
        for (const seed of PROPERTY_SEEDS) {
          expectSoundPlan(world, planSequence(world, { seed, difficulty }), difficulty, seed);
        }
      },
    );

    it.each(DIFFICULTY_LEVELS)('%s: determinista (misma semilla ⇒ mismo plan)', (difficulty) => {
      for (const seed of PROPERTY_SEEDS.slice(0, 40)) {
        expect(planSequence(world, { seed, difficulty })).toEqual(planSequence(world, { seed, difficulty }));
      }
    });

    it.each(DIFFICULTY_LEVELS)('%s: variedad de subconjuntos, órdenes y enunciados', (difficulty) => {
      const plans = PROPERTY_SEEDS.slice(0, 120).map((seed) => planSequence(world, { seed, difficulty }));
      const k = world.sequence.ruleCount[difficulty];
      const orders = new Set(plans.map((p) => p.ruleIds.join('|')));
      const subsets = new Set(plans.map((p) => [...p.ruleIds].sort().join('|')));
      const firstRules = new Set(plans.map((p) => p.ruleIds[0]));
      const statements = new Set(plans.map((p) => p.challenges[1].generation.fingerprint));
      let possibleOrders = 1;
      for (let i = 0; i < k; i++) possibleOrders *= world.rules.length - i;
      expect(firstRules.size).toBe(world.rules.length); // cualquier regla puede ir primero
      expect(orders.size).toBeGreaterThanOrEqual(Math.min(possibleOrders, 40));
      if (k < world.rules.length) expect(subsets.size).toBeGreaterThan(1);
      expect(statements.size).toBeGreaterThan(plans.length / 2);
    });
  },
);

/** Todas las ordenaciones de k elementos de la lista. */
function* orderings(items: readonly string[], k: number, prefix: string[] = []): Generator<string[]> {
  if (prefix.length === k) {
    yield prefix;
    return;
  }
  for (const item of items) if (!prefix.includes(item)) yield* orderings(items, k, [...prefix, item]);
}

describe('cada subconjunto en cada orden es planificable (exhaustivo)', () => {
  const cases = ALL_WORLDS.flatMap((world) =>
    [...new Set(DIFFICULTY_LEVELS)].map((difficulty) => [world.slug, difficulty, world] as const),
  );

  it.each(cases)('%s %s: todas las ordenaciones, sin volver a sortear', (_slug, difficulty, world) => {
    const k = world.sequence.ruleCount[difficulty];
    const failures: string[] = [];
    let count = 0;
    for (const order of orderings(
      world.rules.map((r) => r.id),
      k,
    )) {
      for (const seed of [11, 977]) {
        count += 1;
        const result = planSequenceForRules(world, order, { seed, difficulty });
        if (!result.ok) failures.push(`${order.join(',')} (seed ${seed}) en la posición ${result.position}`);
        else if (count % 25 === 0) expectSoundPlan(world, result.plan, difficulty, seed); // muestra verificada a fondo
      }
    }
    expect(failures).toEqual([]);
    expect(count).toBeGreaterThan(0);
  });
});

describe('planSequence — contrato', () => {
  it('el primer reto no introduce regla y el i-ésimo introduce ruleIds[i - 1]', () => {
    const plan = planSequence(arithmeticWorld, { seed: 42, difficulty: 'HARDER' });
    expect(plan.challenges.map((c) => c.introducesRuleId)).toEqual([null, ...plan.ruleIds]);
  });

  it('semillas extremas admitidas: 0 y 2^31 - 1', () => {
    for (const seed of [0, MAX_SEQUENCE_SEED]) {
      expectSoundPlan(
        arithmeticWorld,
        planSequence(arithmeticWorld, { seed, difficulty: 'BASELINE' }),
        'BASELINE',
        seed,
      );
    }
  });

  it('entradas inválidas ⇒ RangeError (no es un defecto del catálogo)', () => {
    for (const seed of [-1, 1.5, MAX_SEQUENCE_SEED + 1, Number.NaN]) {
      expect(() => planSequence(arithmeticWorld, { seed, difficulty: 'EASIER' })).toThrow(RangeError);
    }
    expect(() =>
      planSequence(arithmeticWorld, { seed: 1, difficulty: 'IMPOSSIBLE' as DifficultyLevel }),
    ).toThrow(RangeError);
  });

  it('la misma semilla en otro mundo o nivel da un plan independiente', () => {
    const [a, b] = [
      planSequence(ALL_WORLDS[0], { seed: 5, difficulty: 'EASIER' }),
      planSequence(ALL_WORLDS[0], { seed: 5, difficulty: 'HARDER' }),
    ];
    expect(a.challenges[0].generation.fingerprint).not.toBe(b.challenges[0].generation.fingerprint);
  });

  it('catálogo defectuoso (una regla que nunca muerde sola) ⇒ SequencePlanningError', () => {
    const defective: WorldDefinition = {
      ...arithmeticWorld,
      slug: 'defective',
      rules: [
        {
          id: 'defective.no-minus',
          type: 'FORBIDDEN_OPERATOR',
          description: 'No restes.',
          config: { operator: '-' },
        },
      ],
      sequence: { ruleCount: { EASIER: 1, BASELINE: 1, HARDER: 1 }, extraTimeSeconds: 0 },
    };
    expect(() => planSequence(defective, { seed: 1, difficulty: 'EASIER' })).toThrow(SequencePlanningError);
  });

  it('ruleCount mayor que el repertorio ⇒ SequencePlanningError', () => {
    const broken: WorldDefinition = {
      ...arithmeticWorld,
      sequence: { ruleCount: { EASIER: 9, BASELINE: 9, HARDER: 9 }, extraTimeSeconds: 0 },
    };
    expect(() => planSequence(broken, { seed: 1, difficulty: 'EASIER' })).toThrow(SequencePlanningError);
  });

  it('no usa Math.random ni el reloj', () => {
    const random = jest.spyOn(Math, 'random');
    const now = jest.spyOn(Date, 'now');
    for (const world of ALL_WORLDS) planSequence(world, { seed: 3, difficulty: 'HARDER' });
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    random.mockRestore();
    now.mockRestore();
  });

  it('rendimiento: típico muy por debajo de 50 ms por secuencia', () => {
    const durations: number[] = [];
    for (const world of ALL_WORLDS) {
      for (const difficulty of DIFFICULTY_LEVELS) {
        for (let seed = 1000; seed < 1040; seed++) {
          const start = process.hrtime.bigint();
          planSequence(world, { seed, difficulty });
          durations.push(Number(process.hrtime.bigint() - start) / 1e6);
        }
      }
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)];
    expect(p95).toBeLessThan(50);
  });
});
