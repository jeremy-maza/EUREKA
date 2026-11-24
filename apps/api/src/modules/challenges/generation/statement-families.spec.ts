import { ExpressionParser, MathEvaluator, MathSyntax, collectNodes, solveLinearEquation } from '../math';
import { ChallengeDifficultyProfile, DEFAULT_DIFFICULTY_PROFILE, StatementFamily } from './generation.types';
import { SeededRandom } from './seeded-random';
import { familyFitsSyntax, familyRejection, generateFamilyStatement } from './statement-families';

const parser = new ExpressionParser();
const evaluator = new MathEvaluator();
const ALL: MathSyntax = { decimals: true, powers: true };
const INTEGERS: MathSyntax = { decimals: false, powers: false };

const statements = (
  family: StatementFamily,
  profile: Partial<ChallengeDifficultyProfile> = {},
  syntax: MathSyntax = ALL,
  count = 300,
) =>
  Array.from({ length: count }, (_, seed) =>
    generateFamilyStatement(family, {
      rng: new SeededRandom(seed),
      profile: { ...DEFAULT_DIFFICULTY_PROFILE, complexity: 'NESTED', ...profile },
      biasDigits: [],
      syntax,
      evaluate: (text) => evaluator.evaluate(parser.parseExpression(text, syntax)),
    }),
  ).filter((s) => s !== null);

const FAMILIES: StatementFamily[] = [
  'MULTIPLICATIVE',
  'SIGNED',
  'FRACTIONAL',
  'DECIMAL',
  'POWER',
  'LINEAR_EQUATION',
];

describe('familias de enunciados', () => {
  it.each(FAMILIES)(
    '%s: todo enunciado se parsea y es evaluable/resoluble en la sintaxis del mundo',
    (family) => {
      const list = statements(family);
      expect(list.length).toBeGreaterThan(250);
      for (const s of list) {
        expect(s.family).toBe(family);
        expect(s.expression.length).toBeLessThan(80);
        if (s.kind === 'EQUATION') {
          expect(() => solveLinearEquation(parser.parseEquation(s.expression, ALL))).not.toThrow();
        } else {
          expect(() => evaluator.evaluate(parser.parseExpression(s.expression, ALL))).not.toThrow();
        }
      }
    },
  );

  it('SIGNED escribe números negativos (entre paréntesis si no van al principio)', () => {
    const list = statements('SIGNED', {}, INTEGERS);
    const withNegation = list.filter((s) =>
      collectNodes(parser.parseExpression(s.expression)).some((n) => n.kind === 'negation'),
    );
    expect(withNegation.length).toBeGreaterThan(list.length / 3);
    for (const s of list) expect(s.expression).not.toMatch(/[+*/-] -/); // nunca "5 - -3"
  });

  it('FRACTIONAL y DECIMAL producen resultados racionales; DECIMAL usa literales decimales', () => {
    const value = (text: string) => evaluator.evaluate(parser.parseExpression(text, ALL));
    expect(statements('FRACTIONAL').some((s) => !value(s.expression).isInteger())).toBe(true);
    for (const s of statements('DECIMAL')) expect(s.expression).toMatch(/\d\.\d/);
    // Algunas sumas/productos decimales dan un entero (para que REQUIRED_DIVISION pueda "morder").
    expect(statements('DECIMAL').some((s) => value(s.expression).isInteger())).toBe(true);
  });

  it('POWER usa el operador ^', () => {
    for (const s of statements('POWER')) expect(s.expression).toContain('^');
  });

  it('LINEAR_EQUATION: ecuación lineal en x con solución única dentro del perfil', () => {
    const list = statements('LINEAR_EQUATION', { operandRange: { min: 1, max: 12 } }, INTEGERS);
    const templates = new Set(list.map((s) => s.templateId));
    expect(templates).toEqual(
      new Set(['EQ_AX', 'EQ_AX_B', 'EQ_X_OVER_A', 'EQ_A_PAREN', 'EQ_BOTH_SIDES', 'EQ_PAREN_PLUS']),
    );
    for (const s of list) {
      expect(s.kind).toBe('EQUATION');
      expect(s.expression).toContain('x');
      const solution = solveLinearEquation(parser.parseEquation(s.expression));
      expect(solution.isInteger()).toBe(true);
      expect(solution.numerator > 0n).toBe(true);
    }
  });

  it('la complejidad PRODUCT solo usa las plantillas más simples', () => {
    const simple = new Set(statements('LINEAR_EQUATION', { complexity: 'PRODUCT' }).map((s) => s.templateId));
    expect([...simple].sort()).toEqual(['EQ_AX', 'EQ_AX_B']);
  });

  it('es determinista', () => {
    for (const family of FAMILIES)
      expect(statements(family, {}, ALL, 50)).toEqual(statements(family, {}, ALL, 50));
  });

  it('familyFitsSyntax: DECIMAL necesita decimales y POWER potencias', () => {
    expect(familyFitsSyntax('DECIMAL', INTEGERS)).toBe(false);
    expect(familyFitsSyntax('POWER', INTEGERS)).toBe(false);
    expect(familyFitsSyntax('LINEAR_EQUATION', INTEGERS)).toBe(true);
  });

  it('familyRejection aplica el perfil (negativos, fracciones, tope de resultado)', () => {
    const p = { ...DEFAULT_DIFFICULTY_PROFILE, maxResult: 100 };
    const f = (text: string) => evaluator.evaluate(parser.parseExpression(text, ALL));
    expect(familyRejection('MULTIPLICATIVE', f('0 - 3'), p)).toBe('NON_POSITIVE_RESULT');
    expect(familyRejection('SIGNED', f('0 - 3'), p)).toBeNull();
    expect(familyRejection('SIGNED', f('0'), p)).toBe('UNSUITABLE_RESULT');
    expect(familyRejection('FRACTIONAL', f('1 / 2'), p)).toBeNull();
    expect(familyRejection('FRACTIONAL', f('-1 / 2'), p)).toBe('NON_POSITIVE_RESULT');
    expect(familyRejection('FRACTIONAL', f('-1 / 2'), { ...p, allowNegative: true })).toBeNull();
    expect(familyRejection('POWER', f('1 / 2'), p)).toBe('FRACTIONAL_RESULT');
    expect(familyRejection('POWER', f('2 ^ 7'), p)).toBe('UNSUITABLE_RESULT');
  });
});
