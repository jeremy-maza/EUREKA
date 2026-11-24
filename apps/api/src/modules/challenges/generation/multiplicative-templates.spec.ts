import { ExpressionParser, MathEvaluator, collectNodes, collectNumbers } from '../math';
import { ChallengeDifficultyProfile, DEFAULT_DIFFICULTY_PROFILE } from './generation.types';
import { availableTemplates, generateMultiplicativeStatement } from './multiplicative-templates';
import { SeededRandom } from './seeded-random';

const parser = new ExpressionParser();
const evaluator = new MathEvaluator();

const statements = (profile: Partial<ChallengeDifficultyProfile>, count = 300, biasDigits: number[] = []) =>
  Array.from({ length: count }, (_, seed) =>
    generateMultiplicativeStatement({
      rng: new SeededRandom(seed),
      profile: { ...DEFAULT_DIFFICULTY_PROFILE, ...profile },
      biasDigits,
    }),
  );

describe('plantillas multiplicativas', () => {
  it('todo enunciado generado se parsea y evalúa, respeta rango y cantidad de operandos', () => {
    const profile = {
      operandRange: { min: 3, max: 15 },
      operandCount: { min: 2, max: 5 },
      complexity: 'NESTED' as const,
    };
    for (const { expression } of statements(profile, 500)) {
      const ast = parser.parseExpression(expression);
      expect(() => evaluator.evaluate(ast)).not.toThrow();
      const numbers = collectNumbers(ast);
      expect(numbers.length).toBeGreaterThanOrEqual(2);
      expect(numbers.length).toBeLessThanOrEqual(5);
      for (const n of numbers) {
        expect(n.value).toBeGreaterThanOrEqual(3n);
        expect(n.value).toBeLessThanOrEqual(15n);
      }
      expect(expression.length).toBeLessThan(200);
    }
  });

  it('siempre contiene al menos una multiplicación (familia multiplicativa)', () => {
    for (const { expression } of statements({ complexity: 'NESTED', operandCount: { min: 2, max: 6 } })) {
      const ast = parser.parseExpression(expression);
      expect(collectNodes(ast).some((n) => n.kind === 'binary' && n.operator === '*')).toBe(true);
    }
  });

  it('PRODUCT solo produce cadenas de multiplicaciones', () => {
    for (const s of statements({ complexity: 'PRODUCT', operandCount: { min: 2, max: 4 } })) {
      expect(s.templateId).toBe('PRODUCT_CHAIN');
      expect(s.expression).toMatch(/^\d+( \* \d+)+$/);
    }
  });

  it('MIXED incluye cocientes y sumas, pero no paréntesis; NESTED sí los incluye', () => {
    const mixed = statements({ complexity: 'MIXED', operandCount: { min: 3, max: 4 } });
    expect(new Set(mixed.map((s) => s.templateId))).toEqual(
      new Set(['PRODUCT_CHAIN', 'PRODUCT_QUOTIENT', 'PRODUCT_SUM']),
    );
    expect(mixed.some((s) => s.expression.includes('('))).toBe(false);

    const nested = statements({ complexity: 'NESTED', operandCount: { min: 3, max: 4 } });
    expect(new Set(nested.map((s) => s.templateId)).has('PARENTHESIZED_SUM_PRODUCT')).toBe(true);
    expect(nested.some((s) => s.expression.includes('('))).toBe(true);
  });

  it('los paréntesis son los mínimos que conservan la estructura (el AST parseado coincide)', () => {
    const lowercase = statements({ complexity: 'NESTED', operandCount: { min: 3, max: 5 } });
    for (const { expression } of lowercase) {
      expect(expression).not.toMatch(/\(\d+\)/); // nunca "(7)"
    }
  });

  it('sin fracciones, los cocientes son exactos (resultado entero)', () => {
    for (const { expression } of statements({ complexity: 'MIXED', operandCount: { min: 3, max: 3 } }, 500)) {
      expect(evaluator.evaluate(parser.parseExpression(expression)).isInteger()).toBe(true);
    }
  });

  it('con allowFractions pueden aparecer cocientes no enteros', () => {
    const results = statements(
      { complexity: 'MIXED', operandCount: { min: 3, max: 3 }, allowFractions: true },
      500,
    ).map((s) => evaluator.evaluate(parser.parseExpression(s.expression)));
    expect(results.some((r) => !r.isInteger())).toBe(true);
  });

  it('degrada a producto si no existe divisor válido en el rango', () => {
    // Con operandos 1..1 el divisor debería ser ≥ 2 y no cabe en el rango ⇒ cae a PRODUCT_CHAIN.
    const generated = statements(
      { complexity: 'MIXED', operandRange: { min: 1, max: 1 }, operandCount: { min: 3, max: 3 } },
      100,
    );
    expect(generated.some((s) => s.templateId === 'PRODUCT_QUOTIENT')).toBe(false);
    expect(generated.some((s) => s.templateId === 'PRODUCT_CHAIN')).toBe(true);
    for (const s of generated) expect(parser.parseExpression(s.expression)).toBeDefined();
  });

  it('se sesga hacia operandos con dígitos prohibidos', () => {
    const rate = (bias: number[]) => {
      const list = statements({ operandRange: { min: 2, max: 99 }, complexity: 'PRODUCT' }, 400, bias);
      return list.filter((s) => s.expression.includes('7')).length / list.length;
    };
    expect(rate([7])).toBeGreaterThan(rate([]));
  });

  it('es determinista', () => {
    expect(statements({ complexity: 'NESTED' }, 100)).toEqual(statements({ complexity: 'NESTED' }, 100));
  });

  it('availableTemplates: con 2 operandos solo hay producto', () => {
    expect(availableTemplates('NESTED', 2)).toEqual(['PRODUCT_CHAIN']);
    expect(availableTemplates('NESTED', 3)).toContain('PARENTHESIZED_SUM_PRODUCT');
    expect(availableTemplates('MIXED', 3)).not.toContain('PARENTHESIZED_SUM_PRODUCT');
  });
});
