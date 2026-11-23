import { ExpressionParser, MathSyntax } from '../../math';
import { createDefaultRuleEngine } from '../rule-engine';
import { InvalidRuleConfigError } from '../rule.errors';
import { RuleDefinition } from '../rule.types';

const parser = new ExpressionParser();
const engine = createDefaultRuleEngine();
const ALL: MathSyntax = { decimals: true, powers: true };
const rule = (type: string, config: Record<string, unknown> = {}): RuleDefinition => ({
  id: `r-${type}`,
  type,
  description: '',
  config,
});
const accepts = (r: RuleDefinition, source: string) =>
  engine.validate([r], { expression: parser.parseExpression(source, ALL) }).length === 0;
const message = (r: RuleDefinition, source: string) =>
  engine.validate([r], { expression: parser.parseExpression(source, ALL) })[0]?.message;

describe('REQUIRED_OPERATOR', () => {
  const division = rule('REQUIRED_OPERATOR', { operator: '/' });
  const subtraction = rule('REQUIRED_OPERATOR', { operator: '-' });
  const power = rule('REQUIRED_OPERATOR', { operator: '^' });

  it('exige el operador con cualquier operando y en cualquier lugar', () => {
    expect(accepts(division, '42 / 2')).toBe(true);
    expect(accepts(division, '3 + (8 / 4) * 2')).toBe(true);
    expect(accepts(division, '21 * 2')).toBe(false);
    expect(accepts(power, '2 ^ 3 + 1')).toBe(true);
    expect(accepts(power, '8 + 1')).toBe(false);
  });

  it('el menos unario no es una resta', () => {
    expect(accepts(subtraction, '-3 + 5')).toBe(false);
    expect(accepts(subtraction, '5 - 3')).toBe(true);
    expect(message(subtraction, '-3')).toContain('no es una resta');
  });

  it('mensajes en español con el nombre de la operación', () => {
    expect(message(division, '21')).toBe('Debes usar al menos una división (/).');
    expect(message(power, '21')).toBe('Debes usar al menos una potencia (^).');
  });
});

describe('FORBIDDEN_OPERATOR', () => {
  const noMinus = rule('FORBIDDEN_OPERATOR', { operator: '-' });
  const noTimes = rule('FORBIDDEN_OPERATOR', { operator: '*' });

  it('rechaza el operador binario, pero no el menos unario', () => {
    expect(accepts(noMinus, '5 + (-3)')).toBe(true);
    expect(accepts(noMinus, '-3 * -2')).toBe(true);
    expect(accepts(noMinus, '5 - 3')).toBe(false);
    expect(message(noMinus, '5 - 3')).toContain('resta');
    expect(accepts(noTimes, '6 + 6')).toBe(true);
    expect(accepts(noTimes, '(2 * 3)')).toBe(false);
  });
});

describe('MIN_NUMBERS', () => {
  const four = rule('MIN_NUMBERS', { count: 4 });

  it('cuenta los literales escritos', () => {
    expect(accepts(four, '1 + 2 + 3 + 4')).toBe(true);
    expect(accepts(four, '7 * 1 * 3')).toBe(false);
    expect(accepts(four, '-(-(-(-21)))')).toBe(false); // los signos no son números
    expect(message(four, '21')).toBe('Debes usar al menos 4 números, pero tu expresión tiene 1 número.');
    expect(message(four, '20 + 1')).toBe('Debes usar al menos 4 números, pero tu expresión tiene 2 números.');
  });
});

describe('MAX_NUMBER', () => {
  const ten = rule('MAX_NUMBER', { max: 10 });

  it('ningún literal puede superar el máximo (el signo no cuenta)', () => {
    expect(accepts(ten, '6 * 7')).toBe(true);
    expect(accepts(ten, '10 * 4 + 2')).toBe(true);
    expect(accepts(ten, '-10 * 4')).toBe(true);
    expect(accepts(ten, '42')).toBe(false);
    expect(accepts(ten, '-12 + 54')).toBe(false);
    expect(accepts(ten, '10.5 - 0.5')).toBe(false); // compara valores exactos
    expect(accepts(ten, '9.99 + 1')).toBe(true);
    expect(message(ten, '6 * 12')).toBe('Ningún número puede ser mayor que 10, pero usaste el 12.');
  });
});

describe('REQUIRED_NEGATIVE', () => {
  const negative = rule('REQUIRED_NEGATIVE');

  it('exige un menos unario', () => {
    expect(accepts(negative, '-3 + 10')).toBe(true);
    expect(accepts(negative, '10 + (-3)')).toBe(true);
    expect(accepts(negative, '-(4 + 3)')).toBe(true);
    expect(accepts(negative, '10 - 3')).toBe(false);
    expect(message(negative, '7')).toContain('número negativo');
  });
});

describe('REQUIRED_DECIMAL', () => {
  const decimal = rule('REQUIRED_DECIMAL');

  it('exige un decimal con parte decimal no nula', () => {
    expect(accepts(decimal, '2.5 * 2')).toBe(true);
    expect(accepts(decimal, '2,25 + 2,75')).toBe(true);
    expect(accepts(decimal, '5 / 2')).toBe(false); // una fracción no es un decimal escrito
    expect(accepts(decimal, '3.0 + 2')).toBe(false); // 3.0 vale un entero
    expect(message(decimal, '3.0 + 2')).toContain('3.0 vale un entero');
    expect(message(decimal, '5')).toBe('Debes usar al menos un número decimal, por ejemplo 0.5.');
  });
});

describe('REQUIRED_PARENTHESES', () => {
  const parentheses = rule('REQUIRED_PARENTHESES');

  it('exige paréntesis necesarios, no de adorno', () => {
    expect(accepts(parentheses, '(2 + 3) * 4')).toBe(true);
    expect(accepts(parentheses, '-(4 + 1)')).toBe(true);
    expect(accepts(parentheses, '(-2) ^ 2')).toBe(true);
    expect(accepts(parentheses, '(7) * 3')).toBe(false);
    expect(accepts(parentheses, '(2 * 3) + 4')).toBe(false);
    expect(accepts(parentheses, '(20 + 1)')).toBe(false);
    expect(message(parentheses, '21')).toContain('cambien el orden de las operaciones');
  });
});

describe('configuración de las reglas nuevas', () => {
  it.each([
    ['REQUIRED_OPERATOR', {}],
    ['REQUIRED_OPERATOR', { operator: '%' }],
    ['FORBIDDEN_OPERATOR', { operator: 'x' }],
    ['MIN_NUMBERS', { count: 1 }],
    ['MIN_NUMBERS', { count: 2.5 }],
    ['MIN_NUMBERS', { count: 100 }],
    ['MAX_NUMBER', { max: 0 }],
    ['MAX_NUMBER', { max: '10' }],
    ['REQUIRED_NEGATIVE', { extra: true }],
    ['REQUIRED_DECIMAL', { count: 1 }],
    ['REQUIRED_PARENTHESES', { n: 2 }],
  ])('%s con %j es inválida', (type, config) => {
    expect(() => engine.assertValidDefinition(rule(type, config))).toThrow(InvalidRuleConfigError);
  });

  it.each([
    ['REQUIRED_OPERATOR', { operator: '^' }],
    ['FORBIDDEN_OPERATOR', { operator: '-' }],
    ['MIN_NUMBERS', { count: 2 }],
    ['MAX_NUMBER', { max: 1 }],
    ['REQUIRED_NEGATIVE', {}],
    ['REQUIRED_DECIMAL', {}],
    ['REQUIRED_PARENTHESES', {}],
    ['REQUIRED_OPERATION', { operator: '^', left: 2, right: 3 }],
  ])('%s con %j es válida', (type, config) => {
    expect(() => engine.assertValidDefinition(rule(type, config))).not.toThrow();
  });

  it('REQUIRED_OPERATION con ^ funciona: 2 ^ 3 cuenta, 3 ^ 2 no', () => {
    const twoCubed = rule('REQUIRED_OPERATION', { operator: '^', left: 2, right: 3 });
    expect(accepts(twoCubed, '2 ^ 3 + 1')).toBe(true);
    expect(accepts(twoCubed, '3 ^ 2')).toBe(false);
  });

  it('REQUIRED_OPERATION compara literales por valor: 7.0 cuenta como 7, 0.7 no', () => {
    const sevenTimesOne = rule('REQUIRED_OPERATION', { operator: '*', left: 7, right: 1 });
    expect(accepts(sevenTimesOne, '7.0 * 1')).toBe(true);
    expect(accepts(sevenTimesOne, '0.7 * 1')).toBe(false);
  });
});
