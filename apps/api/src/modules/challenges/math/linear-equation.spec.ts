import { ExpressionParser } from './expression-parser';
import { linearize, solveLinearEquation } from './linear-equation';
import { MathSyntax } from './syntax';

const parser = new ExpressionParser();
const ALL: MathSyntax = { decimals: true, powers: true };
const solve = (source: string, syntax: MathSyntax = ALL) =>
  solveLinearEquation(parser.parseEquation(source, syntax)).toString();

describe('solveLinearEquation', () => {
  it.each([
    ['3 * x + 4 = 19', '5'],
    ['2 * (x - 3) = 10', '8'],
    ['x / 4 + 1 = 3', '8'],
    ['x + 7 = 2', '-5'],
    ['5 * x = 7', '7/5'],
    ['4 * x + 13 = 7 * x - 2', '5'],
    ['19 = 3 * x + 4', '5'],
    ['-x = 4', '-4'],
    ['-(x - 2) * 3 = 9', '-1'],
    ['0.5 * x = 1.25', '5/2'],
    ['2 ^ 3 * x = 16', '2'],
    ['x ^ 1 + 1 = 3', '2'],
    ['3 * x - x = 8', '4'],
    ['x * 0 + x = 9', '9'],
  ])('%s ⇒ x = %s', (source, expected) => {
    expect(solve(source)).toBe(expected);
  });

  it.each([
    ['x * x = 4', 'NON_LINEAR'],
    ['2 / x = 1', 'NON_LINEAR'],
    ['x ^ 2 = 4', 'NON_LINEAR'],
    ['2 ^ x = 8', 'NON_LINEAR'],
    ['x + 1 = x + 2', 'NO_UNIQUE_SOLUTION'],
    ['2 * x = x + x', 'NO_UNIQUE_SOLUTION'],
    ['3 = 3', 'NO_UNIQUE_SOLUTION'],
  ])('"%s" se rechaza (%s)', (source, code) => {
    expect(() => solve(source)).toThrow(expect.objectContaining({ name: 'EquationError', code }));
  });

  it('una división entre cero dentro de la ecuación se informa como tal', () => {
    expect(() => solve('x / 0 = 1')).toThrow(expect.objectContaining({ name: 'DivisionByZeroError' }));
  });

  it('linearize reduce a coeficiente y término independiente exactos', () => {
    const form = linearize(parser.parseEquation('2 * (x + 3) - x / 2 = 0').left);
    expect(form.coefficient.toString()).toBe('3/2');
    expect(form.constant.toString()).toBe('6');
  });
});
