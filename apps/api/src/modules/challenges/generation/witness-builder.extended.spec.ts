import { ExpressionParser, Fraction, MathEvaluator, MathSyntax, collectNumbers } from '../math';
import { RuleDefinition, createDefaultRuleEngine } from '../rules';
import { RuleConstraints, checkRuleCompatibility } from './rule-compatibility';
import { SeededRandom } from './seeded-random';
import { WitnessBuilder } from './witness-builder';

const parser = new ExpressionParser();
const evaluator = new MathEvaluator();
const ruleEngine = createDefaultRuleEngine();
const builder = new WitnessBuilder({ parser, evaluator, ruleEngine });
const INTEGERS: MathSyntax = { decimals: false, powers: false };
const DECIMALS: MathSyntax = { decimals: true, powers: false };
const POWERS: MathSyntax = { decimals: false, powers: true };
const ALL: MathSyntax = { decimals: true, powers: true };

const rule = (type: string, config: Record<string, unknown> = {}): RuleDefinition => ({
  id: `${type}-${JSON.stringify(config)}`,
  type,
  description: '',
  config,
});
const forbid = (digit: number) => rule('FORBIDDEN_DIGIT', { digit });

const constraintsOf = (rules: RuleDefinition[], syntax: MathSyntax): RuleConstraints => {
  const result = checkRuleCompatibility(rules, { syntax });
  if (result.status !== 'NO_CONFLICT_FOUND') throw new Error(`Reglas de prueba no válidas: ${result.status}`);
  return result.constraints;
};

/** Comprobación independiente del constructor: parser + evaluador + RuleEngine reales. */
function expectValid(source: string, target: Fraction, rules: RuleDefinition[], syntax: MathSyntax): void {
  const ast = parser.parseExpression(source, syntax);
  expect(evaluator.evaluate(ast).equals(target)).toBe(true);
  expect(ruleEngine.validate(rules, { expression: ast })).toEqual([]);
  expect(source.length).toBeLessThanOrEqual(200);
}

function sweep(rules: RuleDefinition[], syntax: MathSyntax, targets: Fraction[]): number {
  const constraints = constraintsOf(rules, syntax);
  let built = 0;
  targets.forEach((target, index) => {
    const result = builder.build({ target, constraints, rng: new SeededRandom(index + 1) });
    if (result.ok) {
      built += 1;
      expectValid(result.expression, target, rules, syntax);
    }
  });
  return built;
}

const integers = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => Fraction.of(from + i));

describe('WitnessBuilder — piezas para cada regla positiva', () => {
  it.each([
    ['REQUIRED_OPERATOR /', [rule('REQUIRED_OPERATOR', { operator: '/' })], INTEGERS],
    ['REQUIRED_OPERATOR -', [rule('REQUIRED_OPERATOR', { operator: '-' })], INTEGERS],
    ['REQUIRED_OPERATOR *', [rule('REQUIRED_OPERATOR', { operator: '*' })], INTEGERS],
    ['REQUIRED_OPERATOR +', [rule('REQUIRED_OPERATOR', { operator: '+' })], INTEGERS],
    ['REQUIRED_OPERATOR ^', [rule('REQUIRED_OPERATOR', { operator: '^' })], POWERS],
    ['REQUIRED_NEGATIVE', [rule('REQUIRED_NEGATIVE')], INTEGERS],
    ['REQUIRED_DECIMAL', [rule('REQUIRED_DECIMAL')], DECIMALS],
    ['REQUIRED_PARENTHESES', [rule('REQUIRED_PARENTHESES')], INTEGERS],
    ['MIN_NUMBERS 5', [rule('MIN_NUMBERS', { count: 5 })], INTEGERS],
    ['MAX_NUMBER 9', [rule('MAX_NUMBER', { max: 9 })], INTEGERS],
  ] as const)('%s: objetivos -60..300 siempre se construyen y son válidos', (_name, rules, syntax) => {
    const targets = integers(-60, 300);
    expect(sweep([...rules], syntax, targets)).toBe(targets.length);
  });

  it('MAX_NUMBER pequeño con números grandes: descompone en q * m + r', () => {
    const rules = [rule('MAX_NUMBER', { max: 10 }), forbid(3)];
    const targets = [1000, 3211, 4096, 9999, 123456].map((n) => Fraction.of(n));
    expect(sweep(rules, INTEGERS, targets)).toBe(targets.length);
  });

  it('FORBIDDEN_OPERATOR: escribe sin el operador prohibido', () => {
    for (const operator of ['+', '-', '*', '/']) {
      const rules = [rule('FORBIDDEN_OPERATOR', { operator }), forbid(2)];
      const targets = integers(1, 150);
      const built = sweep(rules, INTEGERS, targets);
      expect(built).toBeGreaterThan(targets.length * 0.9);
    }
  });

  it('racionales: fracciones y decimales exactos con dígitos prohibidos', () => {
    const targets = [
      Fraction.of(1, 3),
      Fraction.of(7, 2),
      Fraction.of(-5, 4),
      Fraction.of(61, 20),
      Fraction.of(22, 7),
    ];
    expect(sweep([forbid(5), rule('MAX_NUMBER', { max: 10 })], DECIMALS, targets)).toBe(targets.length);
    expect(sweep([rule('REQUIRED_DECIMAL'), forbid(5)], DECIMALS, targets)).toBe(targets.length);
  });

  it('decimales sin dividir: 1.25 se escribe sin "/" si está prohibida', () => {
    const rules = [rule('FORBIDDEN_OPERATOR', { operator: '/' })];
    const targets = [Fraction.of(5, 4), Fraction.of(1, 2), Fraction.of(-7, 10)];
    expect(sweep(rules, DECIMALS, targets)).toBe(targets.length);
  });

  it('respeta MIN_NUMBERS contando literales', () => {
    const rules = [rule('MIN_NUMBERS', { count: 6 }), rule('REQUIRED_NEGATIVE')];
    const constraints = constraintsOf(rules, INTEGERS);
    for (let seed = 1; seed <= 30; seed++) {
      const result = builder.build({
        target: Fraction.of(seed * 7),
        constraints,
        rng: new SeededRandom(seed),
      });
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(collectNumbers(parser.parseExpression(result.expression)).length).toBeGreaterThanOrEqual(6);
    }
  });

  it('combinaciones exigentes de los catálogos (Caos) en todos los objetivos', () => {
    const rules = [
      forbid(0),
      rule('REQUIRED_OPERATOR', { operator: '^' }),
      rule('REQUIRED_DECIMAL'),
      rule('REQUIRED_NEGATIVE'),
      rule('REQUIRED_PARENTHESES'),
      rule('MIN_NUMBERS', { count: 4 }),
      rule('MAX_NUMBER', { max: 12 }),
    ];
    const targets = [...integers(-40, 200), Fraction.of(7, 2), Fraction.of(-13, 6), Fraction.of(1, 3)];
    expect(sweep(rules, ALL, targets)).toBe(targets.length);
  });

  it('la potencia elegida es pequeña frente al objetivo', () => {
    const constraints = constraintsOf([rule('REQUIRED_OPERATOR', { operator: '^' })], POWERS);
    for (let seed = 1; seed <= 30; seed++) {
      const result = builder.build({ target: Fraction.of(5), constraints, rng: new SeededRandom(seed) });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.expression.length).toBeLessThanOrEqual(12);
    }
  });

  it('es determinista con la misma semilla', () => {
    const constraints = constraintsOf([rule('REQUIRED_PARENTHESES'), rule('REQUIRED_NEGATIVE')], INTEGERS);
    const once = () => builder.build({ target: Fraction.of(42), constraints, rng: new SeededRandom(9) });
    expect(once()).toEqual(once());
  });
});
