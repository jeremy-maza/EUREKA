import { MathSyntax } from '../math';
import { RuleDefinition } from '../rules';
import { RuleConflictCode, checkRuleCompatibility } from './rule-compatibility';

const INTEGERS: MathSyntax = { decimals: false, powers: false };
const ALL: MathSyntax = { decimals: true, powers: true };
let counter = 0;
const rule = (type: string, config: Record<string, unknown> = {}): RuleDefinition => ({
  id: `r${++counter}-${type}`,
  type,
  description: '',
  config,
});
const forbid = (digit: number) => rule('FORBIDDEN_DIGIT', { digit });
const op = (operator: string, left: number, right: number) =>
  rule('REQUIRED_OPERATION', { operator, left, right });
const requires = (operator: string) => rule('REQUIRED_OPERATOR', { operator });
const forbids = (operator: string) => rule('FORBIDDEN_OPERATOR', { operator });

const codes = (
  rules: RuleDefinition[],
  syntax: MathSyntax = ALL,
  maxExpressionLength?: number,
): RuleConflictCode[] => {
  const result = checkRuleCompatibility(rules, { syntax, maxExpressionLength });
  return result.status === 'INCOMPATIBLE' ? result.conflicts.map((c) => c.code).sort() : [];
};

describe('checkRuleCompatibility — reglas nuevas: restricciones', () => {
  it('reúne todas las restricciones parseadas', () => {
    const result = checkRuleCompatibility(
      [
        requires('/'),
        requires('^'),
        forbids('-'),
        rule('MIN_NUMBERS', { count: 3 }),
        rule('MIN_NUMBERS', { count: 5 }),
        rule('MAX_NUMBER', { max: 20 }),
        rule('MAX_NUMBER', { max: 12 }),
        rule('REQUIRED_NEGATIVE'),
        rule('REQUIRED_DECIMAL'),
        rule('REQUIRED_PARENTHESES'),
      ],
      { syntax: ALL },
    );
    expect(result.status).toBe('NO_CONFLICT_FOUND');
    if (result.status === 'NO_CONFLICT_FOUND') {
      expect(result.constraints).toMatchObject({
        syntax: ALL,
        requiredOperators: ['/', '^'],
        forbiddenOperators: ['-'],
        minNumbers: 5, // el más exigente
        maxNumber: 12, // el más exigente
        requireNegative: true,
        requireDecimal: true,
        requireParentheses: true,
      });
    }
  });
});

describe('checkRuleCompatibility — incompatibilidades demostradas de las reglas nuevas', () => {
  it('operador exigido y prohibido a la vez (directo o por una operación exigida)', () => {
    expect(codes([requires('*'), forbids('*')])).toEqual(['OPERATOR_REQUIRED_AND_FORBIDDEN']);
    expect(codes([op('*', 7, 1), forbids('*')])).toEqual(['OPERATOR_REQUIRED_AND_FORBIDDEN']);
    expect(codes([requires('*'), forbids('-')])).toEqual([]);
  });

  it('potencias exigidas en un mundo sin potencias', () => {
    expect(codes([requires('^')], INTEGERS)).toEqual(['OPERATOR_NOT_IN_SYNTAX']);
    expect(codes([op('^', 2, 3)], INTEGERS)).toEqual(['OPERATOR_NOT_IN_SYNTAX']);
    expect(codes([requires('^')], ALL)).toEqual([]);
  });

  it('operaciones exigidas que el evaluador nunca acepta (0 ^ 0, exponente enorme)', () => {
    expect(codes([op('^', 0, 0)])).toEqual(['REQUIRED_OPERATION_NOT_EVALUABLE']);
    expect(codes([op('^', 2, 99)])).toEqual(['REQUIRED_OPERATION_NOT_EVALUABLE']);
    expect(codes([op('^', 0, 3)])).toEqual([]);
  });

  it('MAX_NUMBER por debajo de un literal exigido', () => {
    expect(codes([rule('MAX_NUMBER', { max: 6 }), op('*', 7, 1)])).toEqual([
      'MAX_NUMBER_BLOCKS_REQUIRED_LITERAL',
    ]);
    expect(codes([rule('MAX_NUMBER', { max: 7 }), op('*', 7, 1)])).toEqual([]);
  });

  it('ningún literal escribible: el menor dígito permitido supera el máximo', () => {
    expect(codes([forbid(0), forbid(1), rule('MAX_NUMBER', { max: 1 })])).toEqual(['NO_WRITABLE_NUMBER']);
    expect(codes([forbid(1), rule('MAX_NUMBER', { max: 1 })])).toEqual([]); // el 0 sigue disponible
  });

  it('decimales exigidos sin decimales en la sintaxis, o sin ningún decimal escribible', () => {
    expect(codes([rule('REQUIRED_DECIMAL')], INTEGERS)).toEqual(['DECIMALS_NOT_IN_SYNTAX']);
    expect(codes([rule('REQUIRED_DECIMAL')], ALL)).toEqual([]);
    expect(codes([rule('REQUIRED_DECIMAL'), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(forbid)])).toEqual([
      'NO_WRITABLE_DECIMAL',
    ]);
    // Solo el 9: el 9 se puede escribir, pero el menor decimal es 9.9 (> 9).
    expect(
      codes([
        rule('REQUIRED_DECIMAL'),
        rule('MAX_NUMBER', { max: 9 }),
        ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(forbid),
      ]),
    ).toEqual(['NO_WRITABLE_DECIMAL']);
    expect(codes([rule('REQUIRED_DECIMAL'), rule('MAX_NUMBER', { max: 1 }), forbid(0)])).toEqual([
      'NO_WRITABLE_DECIMAL',
    ]); // 1.1 > 1
    expect(codes([rule('REQUIRED_DECIMAL'), rule('MAX_NUMBER', { max: 2 }), forbid(0)])).toEqual([]); // 1.1
  });

  it('paréntesis exigidos con todas las operaciones prohibidas', () => {
    const allButPower = ['+', '-', '*', '/'].map(forbids);
    expect(codes([rule('REQUIRED_PARENTHESES'), ...allButPower], INTEGERS)).toEqual([
      'PARENTHESES_IMPOSSIBLE',
    ]);
    expect(codes([rule('REQUIRED_PARENTHESES'), ...allButPower], ALL)).toEqual([]); // (2 ^ 3) ^ 2
  });

  it('MIN_NUMBERS que no cabe en la longitud máxima', () => {
    expect(codes([rule('MIN_NUMBERS', { count: 10 })], ALL, 18)).toEqual(['MIN_NUMBERS_EXCEED_MAX_LENGTH']);
    expect(codes([rule('MIN_NUMBERS', { count: 10 })], ALL, 19)).toEqual([]);
  });

  it('FORBIDDEN_OPERATOR, REQUIRED_NEGATIVE y MIN_NUMBERS solos nunca son incompatibles', () => {
    expect(
      codes([forbids('+'), forbids('-'), forbids('*'), forbids('/'), rule('REQUIRED_NEGATIVE')]),
    ).toEqual([]);
    expect(codes([rule('MIN_NUMBERS', { count: 20 })])).toEqual([]);
  });
});
