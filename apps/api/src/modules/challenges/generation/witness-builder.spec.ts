import { ExpressionParser, Fraction, MathEvaluator, collectNumbers } from '../math';
import { RuleDefinition, createDefaultRuleEngine } from '../rules';
import { RuleConstraints, checkRuleCompatibility } from './rule-compatibility';
import { SeededRandom } from './seeded-random';
import { WitnessBuilder } from './witness-builder';

const parser = new ExpressionParser();
const evaluator = new MathEvaluator();
const ruleEngine = createDefaultRuleEngine();
const builder = new WitnessBuilder({ parser, evaluator, ruleEngine });

const forbid = (digit: number): RuleDefinition => ({
  id: `no-${digit}`,
  type: 'FORBIDDEN_DIGIT',
  description: '',
  config: { digit },
});
const mustUse = (operator: string, left: number, right: number): RuleDefinition => ({
  id: `req-${left}${operator}${right}`,
  type: 'REQUIRED_OPERATION',
  description: '',
  config: { operator, left, right },
});

const constraintsOf = (rules: RuleDefinition[]): RuleConstraints => {
  const result = checkRuleCompatibility(rules);
  if (result.status !== 'NO_CONFLICT_FOUND')
    throw new Error(`Reglas de prueba incompatibles: ${result.status}`);
  return result.constraints;
};

const build = (target: Fraction, rules: RuleDefinition[], seed = 1) =>
  builder.build({ target, constraints: constraintsOf(rules), rng: new SeededRandom(seed) });

/** Comprobación independiente (no usa `verify`): parsea, evalúa y pasa por el RuleEngine. */
function expectValidWitness(source: string, target: Fraction, rules: RuleDefinition[]): void {
  const ast = parser.parseExpression(source);
  expect(evaluator.evaluate(ast).equals(target)).toBe(true);
  expect(ruleEngine.validate(rules, { expression: ast })).toEqual([]);
}

describe('WitnessBuilder — operación exigida con paréntesis explícitos', () => {
  const rules = [mustUse('*', 7, 1)];

  it('envuelve cada operación exigida en paréntesis', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const result = build(Fraction.of(21), rules, seed);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.expression).toContain('(7 * 1)');
        expectValidWitness(result.expression, Fraction.of(21), rules);
      }
    }
  });

  it('el objetivo coincide con la propia operación: (7 * 1) = 7', () => {
    const result = build(Fraction.of(7), rules);
    expect(result).toMatchObject({ ok: true, expression: '(7 * 1)' });
  });

  it('evita la limitación del AST binario: nunca emite 2 * 7 * 1 sin paréntesis', () => {
    // Si el constructor escribiera `2 * 7 * 1` la regla fallaría; los paréntesis lo evitan.
    expect(builder.verify('2 * 7 * 1', Fraction.of(14), rules)).toMatchObject({
      valid: false,
      reason: 'RULE_VIOLATION',
    });
    expect(builder.verify('2 * (7 * 1)', Fraction.of(14), rules)).toMatchObject({ valid: true });
  });

  it('exige varias operaciones a la vez', () => {
    const several = [mustUse('*', 7, 1), mustUse('+', 3, 4), mustUse('-', 9, 2)];
    for (let seed = 1; seed <= 10; seed++) {
      const result = build(Fraction.of(100), several, seed);
      expect(result.ok).toBe(true);
      if (result.ok) expectValidWitness(result.expression, Fraction.of(100), several);
    }
  });

  it('una operación que vale 0 (7 * 0) no impide alcanzar cualquier objetivo', () => {
    const zero = [mustUse('*', 7, 0)];
    for (const target of [0, 1, 13, 250]) {
      const result = build(Fraction.of(target), zero);
      expect(result.ok).toBe(true);
      if (result.ok) expectValidWitness(result.expression, Fraction.of(target), zero);
    }
  });

  it('la división exigida entre cero no es construible (NO_WITNESS_FOUND)', () => {
    const constraints: RuleConstraints = {
      rules: [mustUse('/', 7, 0)],
      forbiddenDigits: [],
      requiredOperations: [{ operator: '/', left: 7, right: 0 }],
    };
    expect(builder.build({ target: Fraction.of(5), constraints, rng: new SeededRandom(1) })).toEqual({
      ok: false,
      reason: 'NO_WITNESS_FOUND',
    });
  });
});

describe('WitnessBuilder — dígitos prohibidos', () => {
  it('ningún literal contiene el dígito prohibido (42 sin el 2)', () => {
    const rules = [forbid(2)];
    for (let seed = 1; seed <= 20; seed++) {
      const result = build(Fraction.of(42), rules, seed);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const literals = collectNumbers(parser.parseExpression(result.expression));
        expect(literals.some((n) => n.text.includes('2'))).toBe(false);
        expectValidWitness(result.expression, Fraction.of(42), rules);
      }
    }
  });

  it('barrido: objetivos 1..500 con varios dígitos prohibidos y operaciones exigidas', () => {
    const ruleSets = [
      [forbid(0)],
      [forbid(2), forbid(5)],
      [forbid(2), mustUse('*', 7, 1), forbid(5)],
      [forbid(3), forbid(7), mustUse('-', 8, 2)],
    ];
    for (const rules of ruleSets) {
      for (let target = 1; target <= 500; target++) {
        const result = build(Fraction.of(target), rules, target);
        expect(result.ok).toBe(true);
        if (result.ok) expectValidWitness(result.expression, Fraction.of(target), rules);
      }
    }
  });

  it('escribe el 0 sin usar el dígito 0', () => {
    const result = build(Fraction.of(0), [forbid(0)]);
    expect(result.ok).toBe(true);
    if (result.ok) expectValidWitness(result.expression, Fraction.of(0), [forbid(0)]);
  });

  it('sin dígitos disponibles, o con un solo dígito inútil, devuelve NO_WITNESS_FOUND (no incompatibilidad)', () => {
    const noDigits: RuleConstraints = {
      rules: [],
      forbiddenDigits: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      requiredOperations: [],
    };
    expect(
      builder.build({ target: Fraction.of(5), constraints: noDigits, rng: new SeededRandom(1) }),
    ).toEqual({
      ok: false,
      reason: 'NO_WITNESS_FOUND',
    });
    const onlyZero = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(forbid);
    expect(build(Fraction.of(5), onlyZero)).toEqual({ ok: false, reason: 'NO_WITNESS_FOUND' });
  });

  it('es acotado: un objetivo enorme con casi todos los dígitos prohibidos termina enseguida', () => {
    const rules = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(forbid); // solo el 9
    const result = build(Fraction.of(10n ** 30n + 7n), rules);
    expect(result.ok === false || result.ok === true).toBe(true);
  });
});

describe('WitnessBuilder — aritmética exacta', () => {
  it('fracciones: 7/2 y 22/7 se escriben como cociente exacto', () => {
    for (const target of [Fraction.of(7, 2), Fraction.of(22, 7), Fraction.of(1, 3)]) {
      const result = build(target, []);
      expect(result.ok).toBe(true);
      if (result.ok) expectValidWitness(result.expression, target, []);
    }
  });

  it('fracciones con dígitos prohibidos y operación exigida', () => {
    const rules = [forbid(2), mustUse('*', 7, 1)];
    for (const target of [Fraction.of(7, 2), Fraction.of(-22, 7), Fraction.of(101, 4)]) {
      const result = build(target, rules);
      expect(result.ok).toBe(true);
      if (result.ok) expectValidWitness(result.expression, target, rules);
    }
  });

  it('negativos: -5 y -(7 * 1)', () => {
    const rules = [mustUse('*', 7, 1)];
    for (const target of [-5, -7, -30]) {
      const result = build(Fraction.of(target), rules);
      expect(result.ok).toBe(true);
      if (result.ok) expectValidWitness(result.expression, Fraction.of(target), rules);
    }
  });

  it('7 / 2 * 2 vale exactamente 7 (sin coma flotante)', () => {
    expect(builder.verify('7 / 2 * 2', Fraction.of(7), [])).toMatchObject({ valid: true });
    expect(builder.verify('1 / 3 + 1 / 3 + 1 / 3', Fraction.of(1), [])).toMatchObject({ valid: true });
  });
});

describe('WitnessBuilder.verify — rechazo de testigos inválidos', () => {
  const rules = [forbid(2), mustUse('*', 7, 1)];

  it('acepta un testigo correcto', () => {
    const verification = builder.verify('7 * 1 * 6', Fraction.of(42), rules);
    expect(verification.valid).toBe(true);
  });

  it.each([
    ['7 * (', 'SYNTAX_ERROR'],
    ['', 'SYNTAX_ERROR'],
    ['7 * 1 * 6 = 42', 'SYNTAX_ERROR'], // un testigo no lleva "= resultado"
    ['(7 * 1) / 0', 'EVALUATION_ERROR'],
    ['7 * 1 * 5', 'VALUE_MISMATCH'],
    ['21 * 2', 'RULE_VIOLATION'], // vale 42, pero usa el 2 y no usa 7 * 1
    ['41 + 1', 'RULE_VIOLATION'], // cumple "sin 2" y vale 42, pero falta 7 * 1
  ] as const)('rechaza %p con %s', (source, reason) => {
    expect(builder.verify(source, Fraction.of(42), rules)).toMatchObject({ valid: false, reason });
  });

  it('rechaza testigos demasiado largos', () => {
    expect(builder.verify('7 * 1 * 6', Fraction.of(42), rules, 5)).toMatchObject({
      valid: false,
      reason: 'TOO_LONG',
    });
  });

  it('respeta la precedencia de operadores del parser existente', () => {
    expect(builder.verify('2 + 3 * 4', Fraction.of(14), [])).toMatchObject({ valid: true });
    expect(builder.verify('2 + 3 * 4', Fraction.of(20), [])).toMatchObject({
      valid: false,
      reason: 'VALUE_MISMATCH',
    });
    expect(builder.verify('(2 + 3) * 4', Fraction.of(20), [])).toMatchObject({ valid: true });
    expect(builder.verify('8 - 3 - 2', Fraction.of(3), [])).toMatchObject({ valid: true }); // asociativo a la izquierda
    expect(builder.verify('8 / 4 / 2', Fraction.of(1), [])).toMatchObject({ valid: true });
    expect(builder.verify('-2 * 3', Fraction.of(-6), [])).toMatchObject({ valid: true });
  });

  it('build() nunca devuelve un testigo que verify() rechace', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const target = Fraction.of(seed * 13);
      const result = build(target, rules, seed);
      if (result.ok) expect(builder.verify(result.expression, target, rules)).toMatchObject({ valid: true });
    }
  });
});

describe('WitnessBuilder — determinismo', () => {
  it('misma semilla ⇒ mismo testigo; la semilla varía la forma', () => {
    const rules = [forbid(2), mustUse('*', 7, 1), forbid(5)];
    const target = Fraction.of(42);
    expect(build(target, rules, 9)).toEqual(build(target, rules, 9));
    const shapes = new Set(
      Array.from({ length: 30 }, (_, seed) => JSON.stringify(build(target, rules, seed))),
    );
    expect(shapes.size).toBeGreaterThan(1);
  });
});
