import { ChallengeDefinition } from './challenge.types';
import { createChallengeEngine } from './challenge-engine';
import { RuleDefinition } from './rules';

const engine = createChallengeEngine();

const noTwo: RuleDefinition = {
  id: 'no-2',
  type: 'FORBIDDEN_DIGIT',
  description: 'No puedes usar el dígito 2.',
  config: { digit: 2 },
};
const sevenTimesOne: RuleDefinition = {
  id: 'req-7x1',
  type: 'REQUIRED_OPERATION',
  description: 'Debes usar la multiplicación 7 * 1.',
  config: { operator: '*', left: 7, right: 1 },
};

const challenge = (expression: string, expectedResult: string): ChallengeDefinition => ({
  id: 'test',
  position: 1,
  expression,
  expectedResult,
  introducesRuleId: null,
  referenceSolution: expectedResult,
});

const submit = (c: ChallengeDefinition, activeRules: RuleDefinition[], submission: string) =>
  engine.evaluateSubmission({ challenge: c, activeRules, submission });

describe('ChallengeEngine — ejemplos del enunciado', () => {
  it('3 * 7 → 21: "21" es válido', () => {
    const result = submit(challenge('3 * 7', '21'), [], '21');
    expect(result).toMatchObject({ isCorrect: true, failureReason: null, value: '21' });
  });

  it('3 * 7 * 2 → 42 con el dígito 2 prohibido: "41 + 1 = 42" es válido', () => {
    const result = submit(challenge('3 * 7 * 2', '42'), [noTwo], '41 + 1 = 42');
    expect(result.isCorrect).toBe(true);
  });

  it('...pero "21 * 2" tiene el resultado correcto y se rechaza por la regla', () => {
    const result = submit(challenge('3 * 7 * 2', '42'), [noTwo], '21 * 2');
    expect(result).toMatchObject({ isCorrect: false, failureReason: 'RULE_VIOLATION', value: '42' });
    expect(result.violations.map((v) => v.ruleId)).toEqual(['no-2']);
  });

  it('3 * 7 * 2 / 6 → 7 exigiendo 7 * 1: "7 * 1 = 7" es válido', () => {
    const result = submit(challenge('3 * 7 * 2 / 6', '7'), [noTwo, sevenTimesOne], '7 * 1 = 7');
    expect(result.isCorrect).toBe(true);
  });

  it('...y "7" (resultado correcto) se rechaza por no usar 7 * 1', () => {
    const result = submit(challenge('3 * 7 * 2 / 6', '7'), [noTwo, sevenTimesOne], '7');
    expect(result).toMatchObject({ isCorrect: false, failureReason: 'RULE_VIOLATION' });
  });
});

describe('ChallengeEngine — reglas acumuladas', () => {
  const c = challenge('3 * 7 * 2 / 6', '7');

  it('con varias reglas activas cumple todas o falla', () => {
    expect(submit(c, [noTwo, sevenTimesOne], '7 * 1').isCorrect).toBe(true);
    expect(submit(c, [noTwo, sevenTimesOne], '14 / 2').failureReason).toBe('RULE_VIOLATION'); // sin 7*1
    expect(submit(c, [noTwo, sevenTimesOne], '7 * 1 + 2 - 2').failureReason).toBe('RULE_VIOLATION'); // con 2
  });

  it('reporta todas las violaciones a la vez', () => {
    const result = submit(c, [noTwo, sevenTimesOne], '14 / 2');
    expect(result.violations.map((v) => v.ruleId).sort()).toEqual(['no-2', 'req-7x1']);
  });

  it('una regla desbloqueada sigue activa: el mismo reto sin la regla sí acepta la respuesta', () => {
    expect(submit(c, [], '14 / 2').isCorrect).toBe(true);
    expect(submit(c, [noTwo], '56 / 8').isCorrect).toBe(true); // ningún número contiene 2
    expect(submit(c, [noTwo], '42 / 6').failureReason).toBe('RULE_VIOLATION');
  });
});

describe('ChallengeEngine — respuestas incorrectas', () => {
  const c = challenge('3 * 7', '21');

  it('resultado equivocado', () => {
    expect(submit(c, [], '22')).toMatchObject({
      failureReason: 'WRONG_RESULT',
      value: '22',
      isCorrect: false,
    });
  });

  it('sintaxis inválida', () => {
    const result = submit(c, [], '3 *');
    expect(result).toMatchObject({ failureReason: 'SYNTAX_ERROR', value: null });
    expect(result.message).toBeTruthy();
  });

  it('división entre cero', () => {
    expect(submit(c, [], '21 + 1 / 0')).toMatchObject({
      failureReason: 'DIVISION_BY_ZERO',
      isCorrect: false,
    });
  });

  it('el resultado declarado debe coincidir con el valor de la expresión', () => {
    expect(submit(c, [], '3 * 7 = 22')).toMatchObject({ failureReason: 'CLAIMED_RESULT_MISMATCH' });
    expect(submit(c, [], '3 * 7 = 21').isCorrect).toBe(true);
  });

  it('el resultado declarado NO está sujeto a las reglas (solo la expresión)', () => {
    const c42 = challenge('3 * 7 * 2', '42');
    expect(submit(c42, [noTwo], '41 + 1 = 42').isCorrect).toBe(true);
  });

  it('acepta resultados racionales exactos', () => {
    expect(submit(challenge('7 / 2', '7/2'), [], '14 / 4').isCorrect).toBe(true);
    expect(submit(challenge('7 / 2', '7/2'), [], '3 + 1 / 2').isCorrect).toBe(true);
  });
});

describe('ChallengeEngine.verifySolvable', () => {
  const rules = [noTwo, sevenTimesOne];

  it('acepta un reto cuya solución de referencia cumple todas las reglas', () => {
    const c = { ...challenge('3 * 7', '21'), referenceSolution: '7 * 1 * 3' };
    expect(engine.verifySolvable(c, rules)).toEqual({ solvable: true, reason: null });
  });

  it('detecta una solución de referencia que viola una regla', () => {
    const c = { ...challenge('3 * 7', '21'), referenceSolution: '21' };
    const report = engine.verifySolvable(c, rules);
    expect(report.solvable).toBe(false);
    expect(report.reason).toContain('referencia');
  });

  it('detecta un enunciado cuyo valor no coincide con el resultado esperado', () => {
    const c = { ...challenge('3 * 7', '22'), referenceSolution: '7 * 1 * 3' };
    expect(engine.verifySolvable(c, [])).toMatchObject({ solvable: false });
  });

  it('detecta enunciados no evaluables', () => {
    expect(engine.verifySolvable(challenge('3 / 0', '1'), [])).toMatchObject({ solvable: false });
    expect(engine.verifySolvable(challenge('3 +', '1'), [])).toMatchObject({ solvable: false });
  });
});
