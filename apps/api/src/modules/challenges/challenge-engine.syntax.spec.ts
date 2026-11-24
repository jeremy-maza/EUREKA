import { createChallengeEngine } from './challenge-engine';
import { ChallengeDefinition } from './challenge.types';
import { MathSyntax } from './math';
import { RuleDefinition } from './rules';

const engine = createChallengeEngine();
const DECIMALS: MathSyntax = { decimals: true, powers: false };
const POWERS: MathSyntax = { decimals: false, powers: true };
const ALL: MathSyntax = { decimals: true, powers: true };

const rule = (type: string, config: Record<string, unknown> = {}): RuleDefinition => ({
  id: `r-${type}`,
  type,
  description: '',
  config,
});

const expressionChallenge = (
  expression: string,
  expectedResult: string,
  referenceSolution = expectedResult,
) =>
  ({
    id: 't',
    position: 2,
    expression,
    expectedResult,
    introducesRuleId: null,
    referenceSolution,
    statementKind: 'EXPRESSION',
  }) satisfies ChallengeDefinition;

const equation = (expression: string, expectedResult: string, referenceSolution = expectedResult) =>
  ({
    ...expressionChallenge(expression, expectedResult, referenceSolution),
    statementKind: 'EQUATION',
  }) satisfies ChallengeDefinition;

describe('ChallengeEngine con sintaxis por mundo', () => {
  it('sin sintaxis se comporta como el Mundo 1 (decimales y potencias no admitidos)', () => {
    const c = expressionChallenge('5 / 2', '5/2');
    expect(engine.evaluateSubmission({ challenge: c, activeRules: [], submission: '2.5' })).toMatchObject({
      failureReason: 'SYNTAX_ERROR',
    });
    expect(
      engine.evaluateSubmission({
        challenge: expressionChallenge('8', '8'),
        activeRules: [],
        submission: '2 ^ 3',
      }),
    ).toMatchObject({ failureReason: 'SYNTAX_ERROR' });
  });

  it('con decimales: 2.5 ≡ 5/2 y el resultado declarado puede ser decimal', () => {
    const c = expressionChallenge('5 / 2', '5/2');
    const submit = (submission: string) =>
      engine.evaluateSubmission({ challenge: c, activeRules: [], submission, syntax: DECIMALS });
    expect(submit('2.5')).toMatchObject({ isCorrect: true, value: '5/2' });
    expect(submit('1.5 + 1 = 2.5').isCorrect).toBe(true);
    expect(submit('1.5 + 1 = 2,50').isCorrect).toBe(true);
    expect(submit('1.5 + 1 = 2.4')).toMatchObject({
      failureReason: 'CLAIMED_RESULT_MISMATCH',
      message: 'Escribiste "= 2.4", pero tu expresión vale 5/2.',
    });
  });

  it('el resultado declarado (también decimal) no está sujeto a las reglas', () => {
    const c = expressionChallenge('5 / 2', '5/2');
    const noFive = rule('FORBIDDEN_DIGIT', { digit: 5 });
    expect(
      engine.evaluateSubmission({
        challenge: c,
        activeRules: [noFive],
        submission: '1 / 2 + 2 = 2.5',
        syntax: DECIMALS,
      }).isCorrect,
    ).toBe(true);
  });

  it('con potencias; las potencias no evaluables son SYNTAX_ERROR (mensaje claro, sin colgarse)', () => {
    const c = expressionChallenge('8', '8');
    const submit = (submission: string) =>
      engine.evaluateSubmission({ challenge: c, activeRules: [], submission, syntax: POWERS });
    expect(submit('2 ^ 3').isCorrect).toBe(true);
    expect(submit('2 ^ (1 / 2)')).toMatchObject({ failureReason: 'SYNTAX_ERROR', value: null });
    expect(submit('9 ^ 99')).toMatchObject({ failureReason: 'SYNTAX_ERROR' });
    expect(submit('9 ^ 99').message).toContain('exponente');
    expect(submit('0 ^ -2')).toMatchObject({ failureReason: 'DIVISION_BY_ZERO' });
  });

  it('REQUIRED_OPERATOR con ^ funciona en un mundo con potencias', () => {
    const c = expressionChallenge('2 * 4', '8');
    const power = rule('REQUIRED_OPERATOR', { operator: '^' });
    const submit = (submission: string) =>
      engine.evaluateSubmission({ challenge: c, activeRules: [power], submission, syntax: POWERS });
    expect(submit('2 ^ 3').isCorrect).toBe(true);
    expect(submit('2 * 4')).toMatchObject({ failureReason: 'RULE_VIOLATION' });
  });
});

describe('ChallengeEngine — retos de tipo ecuación', () => {
  const eq = equation('3 * x + 4 = 19', '5', '10 / 2');

  it('la respuesta es una expresión que vale la solución', () => {
    const submit = (submission: string, activeRules: RuleDefinition[] = []) =>
      engine.evaluateSubmission({ challenge: eq, activeRules, submission, syntax: POWERS });
    expect(submit('5').isCorrect).toBe(true);
    expect(submit('(19 - 4) / 3').isCorrect).toBe(true);
    expect(submit('4')).toMatchObject({
      failureReason: 'WRONG_RESULT',
      message: 'Tu expresión vale 4, pero ese no es el valor de x que resuelve la ecuación.',
    });
    expect(submit('5', [rule('MIN_NUMBERS', { count: 2 })])).toMatchObject({
      failureReason: 'RULE_VIOLATION',
    });
  });

  it('la x no puede aparecer en la respuesta (SYNTAX_ERROR con mensaje claro)', () => {
    for (const submission of ['x', 'x = 5', '3 * x + 4 = 19', '2 * x']) {
      const result = engine.evaluateSubmission({
        challenge: eq,
        activeRules: [],
        submission,
        syntax: POWERS,
      });
      expect(result).toMatchObject({ isCorrect: false, failureReason: 'SYNTAX_ERROR' });
      expect(result.message).toContain('incógnita');
    }
  });

  it('verifySolvable resuelve la ecuación de forma exacta', () => {
    expect(engine.verifySolvable(eq, [], POWERS)).toEqual({ solvable: true, reason: null });
    expect(engine.verifySolvable(equation('2 * (x - 3) = 10', '8'), [])).toEqual({
      solvable: true,
      reason: null,
    });
    expect(engine.verifySolvable(equation('x / 4 + 1 = 3', '8', '2 * 4'), [])).toEqual({
      solvable: true,
      reason: null,
    });
    expect(engine.verifySolvable(equation('2 * x = 5', '5/2', '2.5'), [], DECIMALS).solvable).toBe(true);
  });

  it('verifySolvable rechaza soluciones declaradas erróneas, ecuaciones no lineales o sin solución única', () => {
    expect(engine.verifySolvable(equation('3 * x + 4 = 19', '6'), []).reason).toContain('x = 5');
    expect(engine.verifySolvable(equation('x * x = 4', '2'), []).solvable).toBe(false);
    expect(engine.verifySolvable(equation('x + 1 = x + 1', '1'), []).solvable).toBe(false);
    expect(engine.verifySolvable(equation('x / 0 = 1', '1'), []).solvable).toBe(false);
    expect(engine.verifySolvable(equation('3 * x = 9', '3', 'x'), []).solvable).toBe(false); // referencia con x
  });

  it('un enunciado de ecuación evaluado como expresión no es resoluble (statementKind importa)', () => {
    expect(engine.verifySolvable(expressionChallenge('3 * x + 4 = 19', '5'), []).solvable).toBe(false);
  });

  it('verifySolvable usa la sintaxis del mundo para la referencia', () => {
    const c = expressionChallenge('5 / 2', '5/2', '2.5');
    expect(engine.verifySolvable(c, []).solvable).toBe(false);
    expect(engine.verifySolvable(c, [], DECIMALS).solvable).toBe(true);
    expect(engine.verifySolvable(expressionChallenge('2 ^ 3', '8', '2 ^ 3'), [], ALL).solvable).toBe(true);
  });
});
