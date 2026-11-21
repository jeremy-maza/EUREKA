import { collectNumbers } from './ast';
import { ExpressionParser } from './expression-parser';
import { ExpressionSyntaxError } from './math.errors';
import { MathEvaluator } from './math-evaluator';

const parser = new ExpressionParser();
const evaluator = new MathEvaluator();
const calc = (source: string) => evaluator.evaluate(parser.parseExpression(source)).toString();

describe('ExpressionParser + MathEvaluator', () => {
  describe('expresiones válidas', () => {
    it.each([
      ['3 * 7', '21'],
      ['3*7*2', '42'],
      ['3 * 7 * 2 / 6', '7'],
      ['2 + 3 * 4', '14'],
      ['(2 + 3) * 4', '20'],
      ['10 - 4 - 3', '3'],
      ['100 / 5 / 4', '5'],
      ['-3 + 5', '2'],
      ['2 * -3', '-6'],
      ['--4', '4'],
      ['((7))', '7'],
      ['7 / 2', '7/2'],
      ['7 / 2 * 2', '7'],
      ['1 / 3 + 2 / 3', '1'],
      ['3 × 7', '21'],
      ['42 ÷ 6', '7'],
      ['9 − 4', '5'],
    ])('%s = %s', (source, expected) => {
      expect(calc(source)).toBe(expected);
    });

    it('acepta expresiones matemáticamente equivalentes con el mismo valor', () => {
      const equivalents = ['21', '3 * 7', '7 * 3', '(1 + 2) * 7', '20 + 1', '42 / 2', '100 - 79'];
      expect(new Set(equivalents.map(calc))).toEqual(new Set(['21']));
    });

    it('respeta la precedencia y la asociatividad por la izquierda', () => {
      expect(calc('8 - 3 - 2')).toBe('3');
      expect(calc('2 * 3 + 4 * 5')).toBe('26');
      expect(calc('24 / 4 * 2')).toBe('12');
    });

    it('conserva el texto de los literales (para reglas de dígitos)', () => {
      const texts = collectNumbers(parser.parseExpression('007 + 41')).map((n) => n.text);
      expect(texts).toEqual(['007', '41']);
    });
  });

  describe('respuesta con "= resultado"', () => {
    it('separa la expresión del resultado declarado', () => {
      const answer = parser.parseAnswer('41 + 1 = 42');
      expect(evaluator.evaluate(answer.expression).toString()).toBe('42');
      expect(answer.claimedResult).toBe(42n);
    });

    it('el resultado es opcional y admite negativos', () => {
      expect(parser.parseAnswer('21').claimedResult).toBeNull();
      expect(parser.parseAnswer('3 - 5 = -2').claimedResult).toBe(-2n);
    });

    it.each(['1 + 1 = 2 = 2', '1 + 1 = ', '1 + 1 = (2)', '1 + 1 = 1 + 1', '= 2'])(
      'rechaza "%s"',
      (source) => {
        expect(() => parser.parseAnswer(source)).toThrow(ExpressionSyntaxError);
      },
    );

    it('parseExpression no admite "="', () => {
      expect(() => parser.parseExpression('1 + 1 = 2')).toThrow(ExpressionSyntaxError);
    });
  });

  describe('sintaxis inválida', () => {
    it.each([
      ['', 'EMPTY_EXPRESSION'],
      ['   ', 'EMPTY_EXPRESSION'],
      ['3 +', 'UNEXPECTED_END'],
      ['* 3', 'UNEXPECTED_TOKEN'],
      ['3 * * 4', 'UNEXPECTED_TOKEN'],
      ['(3 + 4', 'UNBALANCED_PARENTHESES'],
      ['3 + 4)', 'UNBALANCED_PARENTHESES'],
      ['()', 'UNEXPECTED_TOKEN'],
      ['2 3', 'UNEXPECTED_TOKEN'],
      ['2(3)', 'UNEXPECTED_TOKEN'],
      ['(2)(3)', 'UNEXPECTED_TOKEN'],
      ['3 + a', 'UNEXPECTED_CHARACTER'],
      ['3 ^ 2', 'UNEXPECTED_CHARACTER'],
      ['3.5 + 1', 'DECIMALS_NOT_SUPPORTED'],
      ['3,5', 'DECIMALS_NOT_SUPPORTED'],
      ['.5', 'DECIMALS_NOT_SUPPORTED'],
    ])('"%s" → %s', (source, code) => {
      expect(() => parser.parseExpression(source)).toThrow(
        expect.objectContaining({ name: 'ExpressionSyntaxError', code }),
      );
    });

    it('limita la longitud de la expresión', () => {
      const long = '1+'.repeat(150) + '1';
      expect(() => parser.parseExpression(long)).toThrow(
        expect.objectContaining({ code: 'EXPRESSION_TOO_LONG' }),
      );
    });
  });

  describe('seguridad: nunca ejecuta código del jugador', () => {
    it.each([
      'process.exit(1)',
      'constructor.constructor("return 1")()',
      '(() => 1)()',
      'require("fs")',
      '1; 2',
      '`1`',
      '__proto__',
      'globalThis',
    ])('rechaza "%s" como sintaxis inválida', (source) => {
      expect(() => parser.parseExpression(source)).toThrow(ExpressionSyntaxError);
    });
  });

  describe('división entre cero', () => {
    it.each(['1 / 0', '5 / (3 - 3)', '0 / 0', '4 / (2 - 2) + 1', '8 / (1 / 0)'])(
      '"%s" lanza DivisionByZeroError',
      (source) => {
        expect(() => calc(source)).toThrow(expect.objectContaining({ name: 'DivisionByZeroError' }));
      },
    );

    it('0 / 5 es válido', () => {
      expect(calc('0 / 5')).toBe('0');
    });
  });

  it('maneja enteros enormes sin perder precisión', () => {
    expect(calc('99999999999999999999 * 99999999999999999999')).toBe(
      '9999999999999999999800000000000000000001',
    );
  });
});
