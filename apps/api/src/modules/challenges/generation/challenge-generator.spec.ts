import { arithmeticWorld } from '../../worlds/catalog/arithmetic.world';
import { ChallengeEngine, createChallengeEngine } from '../challenge-engine';
import { ChallengeDefinition } from '../challenge.types';
import { ExpressionParser, Fraction, MathEvaluator } from '../math';
import {
  RuleDefinition,
  RuleEngine,
  createDefaultRuleEngine,
  forbiddenDigitRule,
  requiredOperationRule,
} from '../rules';
import { ChallengeGenerator, createChallengeGenerator, generateChallenge } from './challenge-generator';
import {
  CHALLENGE_GENERATOR_VERSION,
  ChallengeGenerationRequest,
  GenerationFailure,
} from './generation.types';

const parser = new ExpressionParser();
const evaluator = new MathEvaluator();
const ruleEngine = createDefaultRuleEngine();
const challengeEngine = createChallengeEngine(ruleEngine);

const forbid = (digit: number): RuleDefinition => ({
  id: `no-${digit}`,
  type: 'FORBIDDEN_DIGIT',
  description: `No ${digit}`,
  config: { digit },
});
const mustUse = (operator: string, left: number, right: number): RuleDefinition => ({
  id: `req-${left}${operator}${right}`,
  type: 'REQUIRED_OPERATION',
  description: `Usa ${left} ${operator} ${right}`,
  config: { operator, left, right },
});

/** Verificador simulado que siempre declara irresoluble el reto. */
class RejectingChallengeEngine extends ChallengeEngine {
  override verifySolvable() {
    return { solvable: false, reason: 'simulado' };
  }
}

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

const request = (overrides: Partial<ChallengeGenerationRequest> = {}): ChallengeGenerationRequest => ({
  position: 2,
  activeRules: [forbid(2)],
  seed: 1,
  ...overrides,
});

function generated(req: ChallengeGenerationRequest) {
  const result = generateChallenge(req);
  if (!result.ok) throw new Error(`Generación fallida: ${JSON.stringify(result.failure)}`);
  return result;
}

function failure(
  req: ChallengeGenerationRequest,
  generator: ChallengeGenerator = createChallengeGenerator(),
): GenerationFailure {
  const result = generator.generate(req);
  if (result.ok) throw new Error(`Se esperaba un fallo, pero se generó "${result.challenge.expression}"`);
  return result.failure;
}

/** Comprobación INDEPENDIENTE del generador: usa los motores existentes sobre el reto ya devuelto. */
function expectChallengeIsSound(challenge: ChallengeDefinition, rules: readonly RuleDefinition[]): void {
  // 1-2. Enunciado parseable/evaluable y resultado esperado = evaluación real.
  const value = evaluator.evaluate(parser.parseExpression(challenge.expression));
  expect(challenge.expectedResult).toBe(value.toString());
  expect(Fraction.parse(challenge.expectedResult).equals(value)).toBe(true);
  // 3-4. La solución de referencia parsea y vale lo mismo.
  const solution = parser.parseExpression(challenge.referenceSolution);
  expect(evaluator.evaluate(solution).equals(value)).toBe(true);
  // 5. Todas las reglas activas aceptan la solución.
  expect(ruleEngine.validate(rules, { expression: solution })).toEqual([]);
  // Verificación oficial del motor existente.
  expect(challengeEngine.verifySolvable(challenge, rules)).toEqual({ solvable: true, reason: null });
}

describe('generateChallenge — sin reglas activas', () => {
  it('genera un reto válido en la posición 1', () => {
    const result = generated({ position: 1, activeRules: [], seed: 7 });
    expect(result.challenge).toMatchObject({ position: 1, introducesRuleId: null });
    expect(result.challenge.id).toMatch(/^generated-1-[0-9a-f]{8}$/);
    expect(result.metadata).toMatchObject({
      generatorVersion: CHALLENGE_GENERATOR_VERSION,
      seed: 7,
      binding: { enforced: false },
    });
    expect(result.metadata.fingerprint).toMatch(/^fp1-[0-9a-f]{32}$/);
    expectChallengeIsSound(result.challenge, []);
  });

  it('cumple todas las semillas del rango', () => {
    for (const seed of SEEDS)
      expectChallengeIsSound(generated({ position: 1, activeRules: [], seed }).challenge, []);
  });

  it('en la posición > 1 sin reglas no hay nada que exigir (binding vacío)', () => {
    const result = generated({ position: 3, activeRules: [], seed: 1 });
    expect(result.metadata.binding).toEqual({
      enforced: false,
      statementViolations: [],
      resultViolations: [],
    });
  });
});

describe('generateChallenge — reglas activas', () => {
  it('una regla activa (FORBIDDEN_DIGIT) que introduce el reto', () => {
    const rules = [forbid(2)];
    for (const seed of SEEDS) {
      const { challenge } = generated({ position: 2, activeRules: rules, introducesRuleId: 'no-2', seed });
      expect(challenge.introducesRuleId).toBe('no-2');
      expectChallengeIsSound(challenge, rules);
      // El dígito prohibido aparece en el enunciado y en el resultado (si no, no "morderían").
      expect(challenge.expression).toContain('2');
      expect(challenge.expectedResult).toContain('2');
    }
  });

  it('una regla activa (REQUIRED_OPERATION)', () => {
    const rules = [mustUse('*', 7, 1)];
    for (const seed of SEEDS) {
      const { challenge, metadata } = generated({
        position: 2,
        activeRules: rules,
        introducesRuleId: rules[0].id,
        seed,
      });
      expectChallengeIsSound(challenge, rules);
      expect(challenge.referenceSolution).toContain('(7 * 1)');
      expect(metadata.binding.statementViolations).toEqual([rules[0].id]);
    }
  });

  it('varias reglas acumuladas de ambos tipos', () => {
    const rules = [forbid(2), mustUse('*', 7, 1), forbid(5), mustUse('+', 3, 4), forbid(0)];
    for (const seed of SEEDS) {
      expectChallengeIsSound(generated({ position: 5, activeRules: rules, seed }).challenge, rules);
    }
  });

  it('cada prefijo del progreso del mundo de Aritmética, para un rango fijo de semillas', () => {
    const world = arithmeticWorld.rules;
    for (let k = 0; k <= world.length; k++) {
      const rules = world.slice(0, k);
      for (const seed of SEEDS) {
        const result = generated({
          position: k + 1,
          activeRules: rules,
          introducesRuleId: k === 0 ? null : rules[k - 1].id,
          seed,
        });
        expectChallengeIsSound(result.challenge, rules);
        expect(result.challenge.position).toBe(k + 1);
        expect(result.metadata.candidateIndex).toBeLessThan(result.metadata.diagnostics.limits.maxCandidates);
      }
    }
  });

  it('los perfiles más exigentes (NESTED, 4-5 operandos, rango amplio) también generan retos válidos', () => {
    const rules = arithmeticWorld.rules;
    for (const seed of SEEDS) {
      const { challenge } = generated({
        position: 4,
        activeRules: rules,
        seed,
        profile: {
          complexity: 'NESTED',
          operandCount: { min: 3, max: 5 },
          operandRange: { min: 2, max: 99 },
        },
      });
      expectChallengeIsSound(challenge, rules);
    }
  });
});

describe('generateChallenge — el reto "muerde" (binding)', () => {
  const rulesList: RuleDefinition[][] = [
    [forbid(2)],
    [mustUse('*', 7, 1)],
    [forbid(2), mustUse('*', 7, 1), forbid(5)],
    [forbid(0), forbid(1)],
  ];

  it('en posiciones > 1, ni el enunciado ni el resultado literal evaden las reglas', () => {
    for (const rules of rulesList) {
      for (const seed of SEEDS) {
        const { challenge, metadata } = generated({ position: 3, activeRules: rules, seed });
        for (const submission of [challenge.expression, challenge.expectedResult]) {
          const evaluation = challengeEngine.evaluateSubmission({
            challenge,
            activeRules: rules,
            submission,
          });
          expect(evaluation).toMatchObject({ isCorrect: false, failureReason: 'RULE_VIOLATION' });
        }
        expect(metadata.binding.enforced).toBe(true);
        expect(metadata.binding.statementViolations.length).toBeGreaterThan(0);
        expect(metadata.binding.resultViolations.length).toBeGreaterThan(0);
      }
    }
  });

  it('en la posición 1 no se exige (el juego lo permite), aunque se pasen reglas', () => {
    const rules = [mustUse('*', 7, 1)];
    for (const seed of SEEDS) {
      const result = generated({ position: 1, activeRules: rules, seed });
      expect(result.metadata.binding.enforced).toBe(false);
      expectChallengeIsSound(result.challenge, rules);
    }
  });

  it('un reto que no puede morder se rechaza (no se devuelve un reto trivial)', () => {
    // Solo existe `2 * 2 = 4`: "4" no contiene el 2 prohibido ⇒ el resultado literal evade la regla.
    const trivial = {
      operandRange: { min: 2, max: 2 },
      operandCount: { min: 2, max: 2 },
      complexity: 'PRODUCT' as const,
    };
    const result = failure(request({ profile: trivial, limits: { maxCandidates: 25 } }));
    expect(result).toMatchObject({ code: 'GENERATION_EXHAUSTED' });
    if (result.code === 'GENERATION_EXHAUSTED') expect(result.diagnostics.rejections.NOT_BINDING).toBe(25);
    // En la posición 1 ese mismo reto sí se acepta.
    expect(generateChallenge(request({ position: 1, profile: trivial })).ok).toBe(true);
  });
});

describe('generateChallenge — determinismo', () => {
  it('la misma petición y semilla producen exactamente el mismo resultado', () => {
    const rules = arithmeticWorld.rules;
    for (const seed of SEEDS) {
      const req = request({ position: 4, activeRules: rules, seed });
      expect(generateChallenge(req)).toEqual(generateChallenge(req));
      expect(createChallengeGenerator().generate(req)).toEqual(generateChallenge(req));
    }
  });

  it('semillas distintas producen retos distintos (no es una constante)', () => {
    const fingerprints = new Set(
      SEEDS.map(
        (seed) =>
          generated(request({ position: 4, activeRules: arithmeticWorld.rules, seed })).metadata.fingerprint,
      ),
    );
    expect(fingerprints.size).toBeGreaterThan(SEEDS.length / 3);
  });

  it('el orden y el tipo de la colección a evitar no cambian el resultado', () => {
    const first = generated(request({ seed: 3 }));
    const second = generated(request({ seed: 4 }));
    const a = generateChallenge(
      request({ seed: 5, avoidFingerprints: [first.metadata.fingerprint, second.metadata.fingerprint] }),
    );
    const b = generateChallenge(
      request({
        seed: 5,
        avoidFingerprints: new Set([second.metadata.fingerprint, first.metadata.fingerprint]),
      }),
    );
    expect(a).toEqual(b);
  });

  it('no usa Math.random ni el reloj', () => {
    const random = jest.spyOn(Math, 'random');
    const now = jest.spyOn(Date, 'now');
    generated(request({ activeRules: arithmeticWorld.rules, position: 4 }));
    failure(request({ activeRules: [forbid(7), mustUse('*', 7, 1)] }));
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    random.mockRestore();
    now.mockRestore();
  });

  it('no muta la petición ni las reglas', () => {
    const rules = [forbid(2), mustUse('*', 7, 1)];
    const req = request({ activeRules: rules, avoidFingerprints: ['x'], limits: { maxCandidates: 50 } });
    const snapshot = JSON.stringify(req);
    generateChallenge(req);
    expect(JSON.stringify(req)).toBe(snapshot);
  });
});

describe('generateChallenge — evitar duplicados', () => {
  it('no repite una huella a evitar y sigue el mismo resultado en lo demás', () => {
    for (const seed of SEEDS) {
      const base = generated(request({ seed }));
      const next = generated(request({ seed, avoidFingerprints: [base.metadata.fingerprint] }));
      expect(next.metadata.fingerprint).not.toBe(base.metadata.fingerprint);
      expect(next.metadata.candidateIndex).toBeGreaterThan(base.metadata.candidateIndex);
      expectChallengeIsSound(next.challenge, [forbid(2)]);
    }
  });

  it('acumular huellas produce una secuencia de retos todos distintos', () => {
    const seen: string[] = [];
    for (let i = 0; i < 15; i++) {
      const { metadata } = generated(request({ seed: 11, avoidFingerprints: seen }));
      expect(seen).not.toContain(metadata.fingerprint);
      seen.push(metadata.fingerprint);
    }
  });

  it('candidatos equivalentes por formato comparten huella: evitar uno evita al otro', () => {
    // Espacio de un solo enunciado conmutativo: 2*2*2 y sus reordenaciones son el mismo reto.
    const tiny = {
      operandRange: { min: 2, max: 2 },
      operandCount: { min: 3, max: 3 },
      complexity: 'PRODUCT' as const,
    };
    const first = generated(request({ position: 1, activeRules: [], profile: tiny }));
    expect(first.challenge.expression).toBe('2 * 2 * 2');
    const result = failure(
      request({
        position: 1,
        activeRules: [],
        profile: tiny,
        avoidFingerprints: [first.metadata.fingerprint],
        limits: { maxCandidates: 10 },
      }),
    );
    expect(result).toMatchObject({ code: 'GENERATION_EXHAUSTED' });
    if (result.code === 'GENERATION_EXHAUSTED') expect(result.diagnostics.rejections.DUPLICATE).toBe(10);
  });

  it('el resultado esperado forma parte de la huella', () => {
    const a = generated(request({ position: 1, activeRules: [], seed: 1 }));
    const b = generated(request({ position: 1, activeRules: [], seed: 2 }));
    expect(a.metadata.fingerprint).not.toBe(b.metadata.fingerprint);
  });
});

describe('generateChallenge — presupuestos y terminación', () => {
  it('maxCandidates agotado ⇒ GENERATION_EXHAUSTED con diagnóstico, nunca un bucle', () => {
    const result = failure(
      request({
        limits: { maxCandidates: 1 },
        avoidFingerprints: [generated(request({ seed: 1 })).metadata.fingerprint],
      }),
    );
    expect(result).toMatchObject({
      code: 'GENERATION_EXHAUSTED',
      diagnostics: { candidatesTried: 1, limits: { maxCandidates: 1 } },
    });
  });

  it('presupuesto de solución: sin solución constructible ⇒ GENERATION_EXHAUSTED (NO INCOMPATIBLE_RULES)', () => {
    // Solo el dígito 0 disponible: las reglas no son incompatibles, pero el constructor no puede escribir nada.
    const onlyZero = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(forbid);
    const limits = { maxCandidates: 8, maxWitnessAttemptsPerCandidate: 3 };
    const result = failure(request({ position: 1, activeRules: onlyZero, limits }));
    expect(result.code).toBe('GENERATION_EXHAUSTED');
    if (result.code === 'GENERATION_EXHAUSTED') {
      expect(result.diagnostics).toMatchObject({ candidatesTried: 8, witnessAttempts: 8 * 3 });
      expect(result.diagnostics.rejections.NO_WITNESS).toBe(8);
    }
  });

  it('los contadores siempre respetan los límites configurados', () => {
    const limits = { maxCandidates: 6, maxWitnessAttemptsPerCandidate: 2 };
    for (const rules of [
      [forbid(2), forbid(5)],
      [mustUse('*', 7, 1), forbid(3)],
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(forbid),
    ]) {
      for (const seed of SEEDS.slice(0, 15)) {
        const { diagnostics } = (() => {
          const r = generateChallenge(request({ activeRules: rules, seed, limits }));
          return r.ok
            ? r.metadata
            : {
                diagnostics: (r.failure as Extract<GenerationFailure, { code: 'GENERATION_EXHAUSTED' }>)
                  .diagnostics,
              };
        })();
        expect(diagnostics.candidatesTried).toBeLessThanOrEqual(6);
        expect(diagnostics.witnessAttempts).toBeLessThanOrEqual(12);
        const rejected = Object.values(diagnostics.rejections).reduce((a, b) => a + b, 0);
        expect(rejected).toBeLessThanOrEqual(diagnostics.candidatesTried);
      }
    }
  });

  it('un presupuesto mínimo (1 candidato, 1 intento) o bien acierta o bien falla de forma tipada', () => {
    for (const seed of SEEDS) {
      const result = generateChallenge(
        request({ seed, limits: { maxCandidates: 1, maxWitnessAttemptsPerCandidate: 1 } }),
      );
      if (!result.ok) expect(result.failure.code).toBe('GENERATION_EXHAUSTED');
    }
  });

  it('un verificador que rechaza la solución impide devolver un reto', () => {
    const generator = new ChallengeGenerator({
      ruleEngine,
      parser,
      evaluator,
      challengeEngine: new RejectingChallengeEngine({ parser, evaluator, ruleEngine }),
    });
    const result = failure(
      request({ position: 1, activeRules: [], limits: { maxCandidates: 5 } }),
      generator,
    );
    expect(result.code).toBe('GENERATION_EXHAUSTED');
    if (result.code === 'GENERATION_EXHAUSTED')
      expect(result.diagnostics.rejections.VERIFICATION_FAILED).toBe(5);
  });

  it('todo reto devuelto con éxito ha pasado verifySolvable (se comprueba que se invoca)', () => {
    const spy = jest.spyOn(challengeEngine, 'verifySolvable');
    const generator = new ChallengeGenerator({ ruleEngine, parser, evaluator, challengeEngine });
    const result = generator.generate(request({ activeRules: arithmeticWorld.rules, position: 4 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(spy).toHaveBeenCalledWith(result.challenge, arithmeticWorld.rules);
      expect(spy.mock.results.at(-1)?.value).toEqual({ solvable: true, reason: null });
    }
    spy.mockRestore();
  });
});

describe('generateChallenge — longitud máxima', () => {
  it('enunciado y solución respetan maxExpressionLength', () => {
    for (const maxExpressionLength of [14, 20, 40]) {
      for (const seed of SEEDS) {
        const result = generateChallenge(
          request({ activeRules: [forbid(2), mustUse('*', 7, 1)], seed, limits: { maxExpressionLength } }),
        );
        if (result.ok) {
          expect(result.challenge.expression.length).toBeLessThanOrEqual(maxExpressionLength);
          expect(result.challenge.referenceSolution.length).toBeLessThanOrEqual(maxExpressionLength);
          expectChallengeIsSound(result.challenge, [forbid(2), mustUse('*', 7, 1)]);
        } else {
          expect(result.failure.code).toBe('GENERATION_EXHAUSTED');
        }
      }
    }
  });

  it('con un límite imposible falla de forma tipada', () => {
    const result = failure(
      request({ position: 1, activeRules: [], limits: { maxExpressionLength: 2, maxCandidates: 10 } }),
    );
    expect(result).toMatchObject({ code: 'GENERATION_EXHAUSTED' });
    if (result.code === 'GENERATION_EXHAUSTED')
      expect(result.diagnostics.rejections.INVALID_STATEMENT).toBe(10);
  });

  it('no admite un límite superior al del parser (200)', () => {
    expect(failure(request({ limits: { maxExpressionLength: 500 } }))).toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('operaciones exigidas que no caben ⇒ INCOMPATIBLE_RULES al instante', () => {
    const result = failure(
      request({ activeRules: [mustUse('*', 10 ** 12, 10 ** 12)], limits: { maxExpressionLength: 20 } }),
    );
    expect(result).toMatchObject({
      code: 'INCOMPATIBLE_RULES',
      conflicts: [{ code: 'REQUIRED_OPERATIONS_EXCEED_MAX_LENGTH' }],
    });
  });
});

describe('generateChallenge — fracciones y aritmética exacta', () => {
  const fractional = { complexity: 'MIXED' as const, operandCount: { min: 3, max: 3 }, allowFractions: true };

  it('con allowFractions se generan retos de resultado fraccionario, válidos y exactos', () => {
    const fractions: string[] = [];
    for (const seed of SEEDS) {
      for (const rules of [[], [forbid(2)], [forbid(2), mustUse('*', 7, 1)]]) {
        const { challenge } = generated({
          position: rules.length + 1,
          activeRules: rules,
          seed,
          profile: fractional,
        });
        expectChallengeIsSound(challenge, rules);
        if (challenge.expectedResult.includes('/')) fractions.push(challenge.expectedResult);
      }
    }
    expect(fractions.length).toBeGreaterThan(0);
    for (const text of fractions) expect(Fraction.parse(text).isInteger()).toBe(false);
  });

  it('por defecto el resultado esperado siempre es un entero positivo', () => {
    for (const seed of SEEDS) {
      const { challenge } = generated(
        request({ seed, position: 1, activeRules: [], profile: { complexity: 'NESTED' } }),
      );
      expect(challenge.expectedResult).toMatch(/^[1-9]\d*$/);
    }
  });
});

describe('generateChallenge — fallos tipados antes de generar', () => {
  const countingGenerator = () => {
    const evaluate = jest.fn((node) => evaluator.evaluate(node));
    const generator = new ChallengeGenerator({
      ruleEngine,
      parser,
      challengeEngine,
      evaluator: { evaluate } as unknown as MathEvaluator,
    });
    return { generator, evaluate };
  };

  it.each([
    [
      'FORBIDDEN_DIGIT(7) + REQUIRED_OPERATION(7 * 1)',
      [forbid(7), mustUse('*', 7, 1)],
      'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL',
    ],
    [
      'FORBIDDEN_DIGIT(1) + REQUIRED_OPERATION(7 * 1)',
      [forbid(1), mustUse('*', 7, 1)],
      'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL',
    ],
    ['REQUIRED_OPERATION(7 / 0)', [mustUse('/', 7, 0)], 'REQUIRED_OPERATION_DIVISION_BY_ZERO'],
    ['los 10 dígitos prohibidos', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(forbid), 'ALL_DIGITS_FORBIDDEN'],
  ] as const)('%s ⇒ INCOMPATIBLE_RULES sin intentar generar', (_name, rules, code) => {
    const { generator, evaluate } = countingGenerator();
    const result = failure(request({ activeRules: rules }), generator);
    expect(result).toMatchObject({ code: 'INCOMPATIBLE_RULES', conflicts: [{ code }] });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('también en la posición 1 (la incompatibilidad no depende del binding)', () => {
    expect(failure(request({ position: 1, activeRules: [mustUse('/', 7, 0)] })).code).toBe(
      'INCOMPATIBLE_RULES',
    );
  });

  it('regla de un tipo desconocido ⇒ UNSUPPORTED_RULE', () => {
    const unknown: RuleDefinition = {
      id: 'x',
      type: 'FORBIDDEN_OPERATION',
      description: '',
      config: { operator: '+' },
    };
    const { generator, evaluate } = countingGenerator();
    expect(failure(request({ activeRules: [forbid(2), unknown] }), generator)).toMatchObject({
      code: 'UNSUPPORTED_RULE',
      issues: [{ code: 'UNKNOWN_RULE_TYPE', ruleId: 'x' }],
    });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('tipo registrado en el RuleEngine pero no soportado por el generador ⇒ UNSUPPORTED_RULE', () => {
    const custom = new RuleEngine([forbiddenDigitRule, requiredOperationRule]).register({
      type: 'FORBIDDEN_OPERATION',
      parseConfig: (raw) => ({ operator: String(raw.operator) }),
      check: () => null,
    });
    const rule: RuleDefinition = {
      id: 'x',
      type: 'FORBIDDEN_OPERATION',
      description: '',
      config: { operator: '+' },
    };
    expect(failure(request({ activeRules: [rule] }), createChallengeGenerator(custom))).toMatchObject({
      code: 'UNSUPPORTED_RULE',
      issues: [{ code: 'RULE_TYPE_NOT_SUPPORTED_BY_GENERATOR' }],
    });
  });

  it('configuración de regla inválida ⇒ INVALID_RULE_CONFIG', () => {
    expect(failure(request({ activeRules: [{ ...forbid(2), config: { digit: 12 } }] }))).toMatchObject({
      code: 'INVALID_RULE_CONFIG',
      issues: [{ ruleId: 'no-2' }],
    });
  });

  it.each([
    ['position 0', { position: 0 }],
    ['position fraccionaria', { position: 1.5 }],
    ['seed no entera', { seed: 0.5 }],
    ['seed NaN', { seed: NaN }],
    ['introducesRuleId inexistente', { introducesRuleId: 'ghost' }],
    ['reglas duplicadas', { activeRules: [forbid(2), forbid(2)] }],
    ['rango de operandos invertido', { profile: { operandRange: { min: 9, max: 3 } } }],
    ['operando 0 (división entre cero posible)', { profile: { operandRange: { min: 0, max: 9 } } }],
    ['cantidad de operandos < 2', { profile: { operandCount: { min: 1, max: 3 } } }],
    ['complejidad desconocida', { profile: { complexity: 'WAT' as never } }],
    ['maxCandidates 0', { limits: { maxCandidates: 0 } }],
    ['maxCandidates desmesurado', { limits: { maxCandidates: 10 ** 9 } }],
    ['intentos de solución 0', { limits: { maxWitnessAttemptsPerCandidate: 0 } }],
    ['challengeId vacío', { challengeId: ' ' }],
    ['huellas no textuales', { avoidFingerprints: [1 as never] }],
  ])('petición inválida (%s) ⇒ INVALID_REQUEST', (_name, overrides) => {
    expect(failure(request(overrides as Partial<ChallengeGenerationRequest>))).toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('INVALID_REQUEST enumera todos los problemas', () => {
    const result = failure(request({ position: 0, seed: 0.5 }));
    expect(result.code === 'INVALID_REQUEST' && result.problems).toHaveLength(2);
  });

  it('challengeId personalizado', () => {
    expect(generated(request({ challengeId: 'arithmetic-dyn-002' })).challenge.id).toBe('arithmetic-dyn-002');
  });
});
