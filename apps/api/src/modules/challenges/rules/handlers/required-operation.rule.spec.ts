import { DivisionByZeroError, ExpressionParser, MathEvaluator } from '../../math';
import { createChallengeEngine } from '../../challenge-engine';
import { createDefaultRuleEngine } from '../rule-engine';
import { RuleDefinition } from '../rule.types';

/**
 * Pruebas de CARACTERIZACIÓN de `REQUIRED_OPERATION`: fijan la semántica actual (incluida su limitación
 * conocida sobre el AST binario) para que el generador de retos no dependa de comportamiento accidental.
 * No definen comportamiento deseado nuevo: si alguna falla, cambió la semántica de la regla.
 */
const parser = new ExpressionParser();
const evaluator = new MathEvaluator();
const ruleEngine = createDefaultRuleEngine();

const rule = (operator: string, left: number, right: number): RuleDefinition => ({
  id: `req-${left}${operator}${right}`,
  type: 'REQUIRED_OPERATION',
  description: `Debes usar ${left} ${operator} ${right}.`,
  config: { operator, left, right },
});
const sevenTimesOne = rule('*', 7, 1);
const accepts = (source: string, r: RuleDefinition = sevenTimesOne) =>
  ruleEngine.validate([r], { expression: parser.parseExpression(source) }).length === 0;

describe('REQUIRED_OPERATION — semántica sobre el AST binario (7 * 1)', () => {
  it('7*1*2 se interpreta como (7*1)*2: contiene 7 * 1', () => {
    expect(accepts('7*1*2')).toBe(true);
  });

  it('2*7*1 se interpreta como (2*7)*1: NO contiene 7 * 1', () => {
    expect(accepts('2*7*1')).toBe(false);
  });

  it('7*(1*2): el operando derecho no es el literal 1, es una multiplicación', () => {
    expect(accepts('7*(1*2)')).toBe(false);
  });

  it('-7*1 se interpreta como (-7)*1: el operando izquierdo es una negación, no el literal 7', () => {
    expect(accepts('-7*1')).toBe(false);
    expect(accepts('-(7*1)')).toBe(true); // la negación envuelve a la operación: el nodo 7*1 sigue ahí
  });

  it('2*(7*1): los paréntesis explícitos hacen visible la operación', () => {
    expect(accepts('2*(7*1)')).toBe(true);
    expect(accepts('(7*1)*2')).toBe(true);
    expect(accepts('3 + (7 * 1)')).toBe(true);
  });

  it('+ y * conmutan (1*7 vale), - y / no', () => {
    expect(accepts('1*7')).toBe(true);
    expect(accepts('7 - 1', rule('-', 7, 1))).toBe(true);
    expect(accepts('1 - 7', rule('-', 7, 1))).toBe(false);
    expect(accepts('7 / 1', rule('/', 7, 1))).toBe(true);
    expect(accepts('1 / 7', rule('/', 7, 1))).toBe(false);
  });

  it('los literales se comparan por valor: 07 * 1 cuenta como 7 * 1', () => {
    expect(accepts('07*1')).toBe(true);
  });
});

describe('REQUIRED_OPERATION — división entre cero', () => {
  const divideByZero = rule('/', 7, 0);

  it('la configuración 7 / 0 es válida para el RuleEngine y la regla "se cumple" estructuralmente con 7/0...', () => {
    expect(() => ruleEngine.assertValidDefinition(divideByZero)).not.toThrow();
    expect(accepts('7/0', divideByZero)).toBe(true);
  });

  it('...pero esa expresión no es evaluable, así que ninguna respuesta puede ser correcta', () => {
    expect(() => evaluator.evaluate(parser.parseExpression('7/0'))).toThrow(DivisionByZeroError);
    expect(() => evaluator.evaluate(parser.parseExpression('(7/0)+3'))).toThrow(DivisionByZeroError);

    const engine = createChallengeEngine(ruleEngine);
    const challenge = {
      id: 'x',
      position: 2,
      expression: '3 + 4',
      expectedResult: '7',
      introducesRuleId: divideByZero.id,
      referenceSolution: '7/0',
    };
    expect(
      engine.evaluateSubmission({ challenge, activeRules: [divideByZero], submission: '7/0' }),
    ).toMatchObject({
      isCorrect: false,
      failureReason: 'DIVISION_BY_ZERO',
    });
    expect(engine.verifySolvable(challenge, [divideByZero]).solvable).toBe(false);
  });
});
