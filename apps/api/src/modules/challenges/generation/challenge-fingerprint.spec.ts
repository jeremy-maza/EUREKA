import { ExpressionParser, Fraction, MathEvaluator } from '../math';
import { canonicalizeExpression, fingerprintChallenge } from './challenge-fingerprint';

const parser = new ExpressionParser();
const evaluator = new MathEvaluator();
const canon = (source: string) => canonicalizeExpression(parser.parseExpression(source));
const fingerprint = (source: string) => {
  const ast = parser.parseExpression(source);
  return fingerprintChallenge(ast, evaluator.evaluate(ast));
};

describe('canonicalizeExpression', () => {
  it('ignora espacios, paréntesis redundantes y ceros a la izquierda', () => {
    expect(canon('3*7')).toBe(canon('  3   *   7 '));
    expect(canon('3 * 7')).toBe(canon('(3) * (7)'));
    expect(canon('03 * 7')).toBe(canon('3 * 7'));
  });

  it('+ y * son conmutativos y asociativos', () => {
    expect(canon('3 * 7')).toBe(canon('7 * 3'));
    expect(canon('3 * 7 * 2')).toBe(canon('2 * (7 * 3)'));
    expect(canon('(3 * 7) * 2')).toBe(canon('3 * (7 * 2)'));
    expect(canon('1 + 2 + 3')).toBe(canon('3 + (2 + 1)'));
    expect(canon('4 - 1 + 2')).toBe(canon('2 + (4 - 1)'));
  });

  it('- y / conservan orden y estructura', () => {
    expect(canon('7 - 3')).not.toBe(canon('3 - 7'));
    expect(canon('8 / 2')).not.toBe(canon('2 / 8'));
    expect(canon('8 - 3 - 1')).not.toBe(canon('8 - (3 - 1)'));
  });

  it('no hace reescritura algebraica ni evalúa subárboles', () => {
    expect(canon('2 * 3')).not.toBe(canon('6'));
    expect(canon('2 * (3 + 4)')).not.toBe(canon('2 * 3 + 2 * 4'));
    expect(canon('-(2)')).not.toBe(canon('2'));
  });
});

describe('fingerprintChallenge', () => {
  it('es estable y tiene un formato fijo', () => {
    expect(fingerprint('3 * 7')).toBe(fingerprint('3 * 7'));
    expect(fingerprint('3 * 7')).toMatch(/^fp1-[0-9a-f]{32}$/);
  });

  it('enunciados equivalentes por formato comparten huella', () => {
    expect(fingerprint('3 * 7 * 2')).toBe(fingerprint('2*(7*3)'));
  });

  it('enunciados distintos tienen huellas distintas', () => {
    expect(fingerprint('3 * 7')).not.toBe(fingerprint('3 * 8'));
    expect(fingerprint('3 * 7 + 1')).not.toBe(fingerprint('3 * (7 + 1)'));
  });

  it('incluye el resultado esperado', () => {
    const ast = parser.parseExpression('3 * 7');
    expect(fingerprintChallenge(ast, Fraction.of(21))).not.toBe(fingerprintChallenge(ast, Fraction.of(22)));
    expect(fingerprintChallenge(ast, Fraction.of(21))).toBe(fingerprintChallenge(ast, Fraction.parse('21')));
  });
});
