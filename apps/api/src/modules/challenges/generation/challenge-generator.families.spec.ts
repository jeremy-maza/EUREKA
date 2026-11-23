import { createChallengeEngine } from '../challenge-engine';
import { ChallengeDefinition } from '../challenge.types';
import { MathSyntax } from '../math';
import { RuleDefinition, createDefaultRuleEngine } from '../rules';
import { generateChallenge, resultForms } from './challenge-generator';
import { ChallengeGenerationRequest, StatementFamily } from './generation.types';

const ruleEngine = createDefaultRuleEngine();
const challengeEngine = createChallengeEngine(ruleEngine);
const INTEGERS: MathSyntax = { decimals: false, powers: false };
const DECIMALS: MathSyntax = { decimals: true, powers: false };
const POWERS: MathSyntax = { decimals: false, powers: true };
const ALL: MathSyntax = { decimals: true, powers: true };
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

const rule = (type: string, config: Record<string, unknown> = {}): RuleDefinition => ({
  id: `${type}-${JSON.stringify(config)}`,
  type,
  description: '',
  config,
});

function generated(request: ChallengeGenerationRequest) {
  const result = generateChallenge(request);
  if (!result.ok) throw new Error(`Generación fallida: ${JSON.stringify(result.failure).slice(0, 500)}`);
  return result;
}

/** Comprobación independiente: verificación oficial + el reto muerde en todas las escrituras del resultado. */
function expectSoundAndBinding(
  challenge: ChallengeDefinition,
  rules: RuleDefinition[],
  syntax: MathSyntax,
): void {
  expect(challengeEngine.verifySolvable(challenge, rules, syntax)).toEqual({ solvable: true, reason: null });
  expect(challengeEngine.statementValue(challenge, syntax).toString()).toBe(challenge.expectedResult);
  if (challenge.position < 2 || rules.length === 0) return;
  const submissions = [
    ...(challenge.statementKind === 'EQUATION' ? [] : [challenge.expression]),
    ...resultForms(challengeEngine.statementValue(challenge, syntax), syntax),
  ];
  for (const submission of submissions) {
    expect(
      challengeEngine.evaluateSubmission({ challenge, activeRules: rules, submission, syntax }),
    ).toMatchObject({ isCorrect: false, failureReason: 'RULE_VIOLATION' });
  }
}

describe('generateChallenge — familias y sintaxis', () => {
  const cases: Array<[StatementFamily, MathSyntax, RuleDefinition[]]> = [
    ['SIGNED', INTEGERS, [rule('REQUIRED_NEGATIVE')]],
    ['SIGNED', INTEGERS, [rule('MAX_NUMBER', { max: 10 }), rule('REQUIRED_OPERATOR', { operator: '-' })]],
    ['FRACTIONAL', DECIMALS, [rule('REQUIRED_DECIMAL')]],
    ['DECIMAL', DECIMALS, [rule('REQUIRED_OPERATOR', { operator: '/' })]],
    ['DECIMAL', DECIMALS, [rule('FORBIDDEN_DIGIT', { digit: 5 }), rule('MIN_NUMBERS', { count: 3 })]],
    ['POWER', POWERS, [rule('REQUIRED_PARENTHESES')]],
    ['LINEAR_EQUATION', POWERS, [rule('REQUIRED_OPERATOR', { operator: '^' })]],
    [
      'LINEAR_EQUATION',
      ALL,
      [rule('REQUIRED_DECIMAL'), rule('REQUIRED_NEGATIVE'), rule('MAX_NUMBER', { max: 12 })],
    ],
  ];

  it.each(cases)('%s (%j) con %j: retos verificados que muerden', (family, syntax, rules) => {
    for (const seed of SEEDS) {
      const { challenge, metadata } = generated({
        position: 2,
        activeRules: rules,
        introducesRuleId: rules[0].id,
        seed,
        families: [{ family, weight: 1 }],
        syntax,
        profile: { operandRange: { min: 1, max: 15 }, complexity: 'NESTED', allowNegative: true },
      });
      expect(metadata.family).toBe(family);
      expect(challenge.statementKind).toBe(family === 'LINEAR_EQUATION' ? 'EQUATION' : 'EXPRESSION');
      expect(metadata.statementKind).toBe(challenge.statementKind);
      expectSoundAndBinding(challenge, rules, syntax);
    }
  });

  it('en una ecuación el resultado esperado es la solución exacta (del solver), nunca asignado a mano', () => {
    for (const seed of SEEDS) {
      const { challenge } = generated({
        position: 1,
        activeRules: [],
        seed,
        families: [{ family: 'LINEAR_EQUATION', weight: 1 }],
        syntax: ALL,
        profile: { complexity: 'NESTED', allowFractions: true, allowNegative: true },
      });
      expect(challengeEngine.statementValue(challenge, ALL).toString()).toBe(challenge.expectedResult);
    }
  });

  it('el binding prueba también la escritura decimal del resultado (no basta con "7/2")', () => {
    // Con solo REQUIRED_DIVISION, un resultado 7/2 no puede morder: "3.5" no usa "/". Deben salir enteros.
    for (const seed of SEEDS) {
      const { challenge } = generated({
        position: 2,
        activeRules: [rule('REQUIRED_OPERATOR', { operator: '/' })],
        seed,
        families: [{ family: 'DECIMAL', weight: 1 }],
        syntax: DECIMALS,
      });
      expect(challenge.expectedResult).toMatch(/^-?\d+$/);
    }
  });

  it('las familias mezcladas por peso aparecen todas', () => {
    const families = new Set(
      SEEDS.map(
        (seed) =>
          generated({
            position: 1,
            activeRules: [],
            seed,
            syntax: ALL,
            families: [
              { family: 'SIGNED', weight: 1 },
              { family: 'POWER', weight: 1 },
              { family: 'LINEAR_EQUATION', weight: 2 },
            ],
          }).metadata.family,
      ),
    );
    expect(families).toEqual(new Set(['SIGNED', 'POWER', 'LINEAR_EQUATION']));
  });

  it('maxResult acota el resultado', () => {
    for (const seed of SEEDS) {
      const { challenge } = generated({
        position: 1,
        activeRules: [],
        seed,
        profile: { operandRange: { min: 2, max: 30 }, operandCount: { min: 3, max: 4 }, maxResult: 200 },
        families: [{ family: 'MULTIPLICATIVE', weight: 1 }],
      });
      expect(Math.abs(Number(challenge.expectedResult))).toBeLessThanOrEqual(200);
    }
  });

  it('peticiones inválidas: familia desconocida, sintaxis que no la admite, pesos inválidos', () => {
    const base = { position: 1, activeRules: [], seed: 1 };
    for (const request of [
      { ...base, families: [] },
      { ...base, families: [{ family: 'NOPE' as StatementFamily, weight: 1 }] },
      { ...base, families: [{ family: 'DECIMAL' as const, weight: 1 }], syntax: INTEGERS },
      { ...base, families: [{ family: 'POWER' as const, weight: 1 }] },
      { ...base, families: [{ family: 'SIGNED' as const, weight: 0 }] },
      {
        ...base,
        families: [
          { family: 'SIGNED' as const, weight: 1 },
          { family: 'SIGNED' as const, weight: 1 },
        ],
      },
      { ...base, profile: { maxResult: 0 } },
    ]) {
      const result = generateChallenge(request);
      expect(result.ok === false && result.failure.code).toBe('INVALID_REQUEST');
    }
  });

  it('reglas incompatibles con la sintaxis ⇒ INCOMPATIBLE_RULES', () => {
    const result = generateChallenge({ position: 2, activeRules: [rule('REQUIRED_DECIMAL')], seed: 1 });
    expect(result).toMatchObject({ ok: false, failure: { code: 'INCOMPATIBLE_RULES' } });
  });

  it('FORBIDDEN_OPERATOR sola nunca muerde el resultado literal (por eso no está en los catálogos)', () => {
    const result = generateChallenge({
      position: 2,
      activeRules: [rule('FORBIDDEN_OPERATOR', { operator: '-' })],
      seed: 1,
      families: [{ family: 'SIGNED', weight: 1 }],
      limits: { maxCandidates: 60 },
    });
    expect(result).toMatchObject({ ok: false, failure: { code: 'GENERATION_EXHAUSTED' } });
    // Acompañada de otra regla que sí muerde, se genera sin problema.
    const combined = [rule('FORBIDDEN_OPERATOR', { operator: '-' }), rule('MIN_NUMBERS', { count: 3 })];
    const { challenge } = generated({
      position: 3,
      activeRules: combined,
      seed: 1,
      families: [{ family: 'SIGNED', weight: 1 }],
    });
    expectSoundAndBinding(challenge, combined, INTEGERS);
  });
});
