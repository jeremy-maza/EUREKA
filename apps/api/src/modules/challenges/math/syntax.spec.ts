import { collectNumbers, necessaryGroups, numberValue } from './ast';
import { ExpressionParser } from './expression-parser';
import { Fraction } from './fraction';
import { MAX_POWER_EXPONENT, MathEvaluator } from './math-evaluator';
import { DEFAULT_MATH_SYNTAX, MathSyntax } from './syntax';

const parser = new ExpressionParser();
const evaluator = new MathEvaluator();
const DECIMALS: MathSyntax = { decimals: true, powers: false };
const POWERS: MathSyntax = { decimals: false, powers: true };
const ALL: MathSyntax = { decimals: true, powers: true };
const calc = (source: string, syntax: MathSyntax) =>
  evaluator.evaluate(parser.parseExpression(source, syntax)).toString();

describe('sintaxis por defecto (Mundo 1): sin cambios', () => {
  it('la sintaxis por defecto no admite decimales ni potencias', () => {
    expect(DEFAULT_MATH_SYNTAX).toEqual({ decimals: false, powers: false });
    expect(() => parser.parseExpression('2.5')).toThrow(
      expect.objectContaining({ code: 'DECIMALS_NOT_SUPPORTED' }),
    );
    expect(() => parser.parseExpression('2 ^ 3')).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_CHARACTER' }),
    );
    expect(() => parser.parseExpression('2 ^ 3', DECIMALS)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_CHARACTER' }),
    );
  });

  it('los mensajes de error del Mundo 1 se conservan literalmente', () => {
    expect(() => parser.parseExpression('3.5 + 1')).toThrow(
      'Los números decimales todavía no están permitidos en este mundo.',
    );
    expect(() => parser.parseExpression('3 x 7')).toThrow('Carácter no permitido "x" en la posición 3.');
    expect(() => parser.parseAnswer('1 + 1 = (2)')).toThrow(
      'Después del signo = debe ir solo el resultado (un número entero).',
    );
  });

  it('los literales enteros no llevan campos nuevos (el AST del Mundo 1 no cambia)', () => {
    const [number] = collectNumbers(parser.parseExpression('7'));
    expect(number).toEqual({ kind: 'number', value: 7n, text: '7' });
  });
});

describe('decimales exactos', () => {
  it.each([
    ['2.5', '5/2'],
    ['2,5', '5/2'],
    ['0.1 + 0.2', '3/10'],
    ['2.5 * 4', '10'],
    ['7.5 / 2.5', '3'],
    ['1.25 - 3', '-7/4'],
    ['-0.5 * 0.5', '-1/4'],
    ['2.50', '5/2'],
  ])('%s = %s', (source, expected) => {
    expect(calc(source, DECIMALS)).toBe(expected);
  });

  it('conserva el texto original del literal (para reglas de dígitos)', () => {
    const numbers = collectNumbers(parser.parseExpression('2,50 + 0.5', DECIMALS));
    expect(numbers.map((n) => n.text)).toEqual(['2,50', '0.5']);
    expect(numbers.map((n) => numberValue(n).toString())).toEqual(['5/2', '1/2']);
  });

  it.each(['3.', '3. + 1', '.5', '1.2.3', '1,2,3'])('rechaza el literal mal formado "%s"', (source) => {
    expect(() => parser.parseExpression(source, DECIMALS)).toThrow(
      expect.objectContaining({ name: 'ExpressionSyntaxError', code: 'INVALID_NUMBER' }),
    );
  });

  it('el resultado declarado admite decimales solo si el mundo los admite', () => {
    const answer = parser.parseAnswer('5 / 2 = 2.5', DECIMALS);
    expect(answer.claimedValue?.equals(Fraction.of(5, 2))).toBe(true);
    expect(answer.claimedResult).toBeNull();
    expect(answer.claimedText).toBe('2.5');
    expect(parser.parseAnswer('3 - 5 = -2', DECIMALS)).toMatchObject({
      claimedResult: -2n,
      claimedText: '-2',
    });
    expect(() => parser.parseAnswer('5 / 2 = 2.5')).toThrow(
      expect.objectContaining({ code: 'DECIMALS_NOT_SUPPORTED' }),
    );
    expect(() => parser.parseAnswer('1 + 1 = (2)', DECIMALS)).toThrow(
      'Después del signo = debe ir solo el resultado (un número entero o decimal).',
    );
  });
});

describe('potencias', () => {
  it.each([
    ['2 ^ 3', '8'],
    ['2 ^ 3 ^ 2', '512'], // asociativa por la derecha: 2 ^ 9
    ['(2 ^ 3) ^ 2', '64'],
    ['-2 ^ 2', '-4'], // el menos unario se aplica después: -(2 ^ 2)
    ['(-2) ^ 2', '4'],
    ['(-2) ^ 3', '-8'],
    ['2 ^ -1', '1/2'],
    ['2 ^ (1 + 1) * 3', '12'],
    ['3 * 2 ^ 2', '12'],
    ['10 ^ 0', '1'],
    ['(1 / 2) ^ 2', '1/4'],
  ])('%s = %s', (source, expected) => {
    expect(calc(source, POWERS)).toBe(expected);
  });

  it('con decimales y potencias a la vez', () => {
    expect(calc('0.5 ^ 2', ALL)).toBe('1/4');
    expect(calc('2 ^ 2.0', ALL)).toBe('4'); // 2.0 vale un entero: es un exponente válido
  });

  it.each([
    ['2 ^ (1 / 2)', 'NON_INTEGER_EXPONENT'],
    [`2 ^ ${MAX_POWER_EXPONENT + 1}`, 'EXPONENT_TOO_LARGE'],
    ['2 ^ -13', 'EXPONENT_TOO_LARGE'],
    ['0 ^ 0', 'ZERO_TO_ZERO'],
    ['((99 ^ 12) ^ 12) ^ 12', 'RESULT_TOO_LARGE'],
  ])('"%s" es un error matemático acotado (%s), nunca un cálculo desmesurado', (source, code) => {
    expect(() => calc(source, POWERS)).toThrow(expect.objectContaining({ name: 'InvalidPowerError', code }));
  });

  it('0 elevado a un exponente negativo divide entre cero', () => {
    expect(() => calc('0 ^ -1', POWERS)).toThrow(expect.objectContaining({ name: 'DivisionByZeroError' }));
  });

  it('el límite de exponente admite justo 12', () => {
    expect(calc(`2 ^ ${MAX_POWER_EXPONENT}`, POWERS)).toBe('4096');
  });
});

describe('paréntesis: marca de agrupación', () => {
  it('marca el nodo escrito entre paréntesis sin cambiar su valor', () => {
    const ast = parser.parseExpression('(2 + 3) * 4');
    expect(ast).toMatchObject({ kind: 'binary', operator: '*', left: { operator: '+', grouped: true } });
    expect(evaluator.evaluate(ast).toString()).toBe('20');
  });

  it.each([
    ['(2 + 3) * 4', 1],
    ['4 * (2 + 3)', 1],
    ['10 - (3 + 2)', 1],
    ['10 - (3 - 2)', 1],
    ['-(4 + 1)', 1],
    ['-(4 * 2)', 1],
    ['8 / (2 * 2)', 1],
    ['(1 + 2) * (3 + 4)', 2],
    ['((1 + 2)) * 3', 1],
  ])('"%s" tiene %d grupo(s) necesario(s)', (source, count) => {
    expect(necessaryGroups(parser.parseExpression(source))).toHaveLength(count);
  });

  it.each(['(7) * 3', '(2 * 3) + 4', '2 * (-3)', '(2 + 3)', '((7))', '2 + (3 * 4)', '-(-3)', '7 * 1 * 3'])(
    '"%s" no tiene paréntesis necesarios',
    (source) => {
      expect(necessaryGroups(parser.parseExpression(source))).toEqual([]);
    },
  );

  it('en potencias: la base compuesta los necesita; el exponente negativo no', () => {
    expect(necessaryGroups(parser.parseExpression('(-2) ^ 2', POWERS))).toHaveLength(1);
    expect(necessaryGroups(parser.parseExpression('(2 ^ 3) ^ 2', POWERS))).toHaveLength(1);
    expect(necessaryGroups(parser.parseExpression('2 ^ (3 ^ 2)', POWERS))).toEqual([]);
    expect(necessaryGroups(parser.parseExpression('2 ^ (-1)', POWERS))).toEqual([]);
    expect(necessaryGroups(parser.parseExpression('-(2 ^ 2)', POWERS))).toEqual([]);
  });
});

describe('ecuaciones (solo enunciados)', () => {
  it('parsea "lado = lado" con la incógnita x', () => {
    const equation = parser.parseEquation('3 * x + 4 = 19');
    expect(equation.left).toMatchObject({ kind: 'binary', operator: '+' });
    expect(equation.right).toMatchObject({ kind: 'number', value: 19n });
  });

  it('exige un único signo =', () => {
    expect(() => parser.parseEquation('3 * x + 4')).toThrow(
      expect.objectContaining({ code: 'INVALID_EQUATION' }),
    );
    expect(() => parser.parseEquation('x = 1 = 1')).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_TOKEN' }),
    );
  });

  it('no existe la multiplicación implícita: "3x" no es válido', () => {
    expect(() => parser.parseEquation('3x = 6')).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_TOKEN' }),
    );
  });

  it('en una respuesta a una ecuación, la x da un error claro', () => {
    expect(() => parser.parseAnswer('x + 1', DEFAULT_MATH_SYNTAX, { equation: true })).toThrow(
      expect.objectContaining({ code: 'VARIABLE_NOT_ALLOWED' }),
    );
    expect(() => parser.parseAnswer('x + 1', DEFAULT_MATH_SYNTAX, { equation: true })).toThrow(
      /incógnita "x"/,
    );
  });
});
