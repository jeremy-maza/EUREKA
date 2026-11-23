import { ExpressionParser } from '../math';
import { forbiddenDigitRule } from './handlers/forbidden-digit.rule';
import { RuleAccumulator } from './rule-accumulator';
import { RuleEngine, createDefaultRuleEngine } from './rule-engine';
import { InvalidRuleConfigError, UnknownRuleTypeError } from './rule.errors';
import { RuleDefinition, RuleHandler } from './rule.types';

const parser = new ExpressionParser();
const engine = createDefaultRuleEngine();
const ctx = (source: string) => ({ expression: parser.parseExpression(source) });

const noTwo: RuleDefinition = {
  id: 'no-2',
  type: 'FORBIDDEN_DIGIT',
  description: 'No puedes usar el 2.',
  config: { digit: 2 },
};
const sevenTimesOne: RuleDefinition = {
  id: 'req-7x1',
  type: 'REQUIRED_OPERATION',
  description: 'Debes usar 7 * 1.',
  config: { operator: '*', left: 7, right: 1 },
};
const noFive: RuleDefinition = { ...noTwo, id: 'no-5', config: { digit: 5 } };

describe('FORBIDDEN_DIGIT', () => {
  it('rechaza cualquier número que contenga el dígito', () => {
    expect(engine.validate([noTwo], ctx('41 + 1'))).toEqual([]);
    expect(engine.validate([noTwo], ctx('21'))).toHaveLength(1);
    expect(engine.validate([noTwo], ctx('3 * 7 * 2'))).toHaveLength(1);
    expect(engine.validate([noTwo], ctx('100 - 58'))).toEqual([]);
  });

  it('no se evade con paréntesis, negativos ni ceros a la izquierda', () => {
    expect(engine.validate([noTwo], ctx('-(2)'))).toHaveLength(1);
    expect(engine.validate([noTwo], ctx('002 + 40'))).toHaveLength(1);
  });

  it('informa qué regla y número lo incumplen', () => {
    const [violation] = engine.validate([noTwo], ctx('12 + 30'));
    expect(violation).toMatchObject({ ruleId: 'no-2', ruleType: 'FORBIDDEN_DIGIT' });
    expect(violation.message).toContain('12');
  });
});

describe('REQUIRED_OPERATION', () => {
  it('exige la operación indicada', () => {
    expect(engine.validate([sevenTimesOne], ctx('7 * 1'))).toEqual([]);
    expect(engine.validate([sevenTimesOne], ctx('7 + 0'))).toHaveLength(1);
    expect(engine.validate([sevenTimesOne], ctx('7'))).toHaveLength(1);
  });

  it('la encuentra anidada y en cualquier posición', () => {
    expect(engine.validate([sevenTimesOne], ctx('(7 * 1) * 3'))).toEqual([]);
    expect(engine.validate([sevenTimesOne], ctx('3 + (7 * 1)'))).toEqual([]);
    expect(engine.validate([sevenTimesOne], ctx('3 * 4 - 5 + 7 * 1'))).toEqual([]);
  });

  it('los operandos conmutan en + y *, pero no en - y /', () => {
    expect(engine.validate([sevenTimesOne], ctx('1 * 7'))).toEqual([]);
    const minus: RuleDefinition = { ...sevenTimesOne, config: { operator: '-', left: 7, right: 1 } };
    expect(engine.validate([minus], ctx('7 - 1'))).toEqual([]);
    expect(engine.validate([minus], ctx('1 - 7'))).toHaveLength(1);
  });

  it('exige operandos literales: (3 + 4) * 1 no contiene 7 * 1', () => {
    expect(engine.validate([sevenTimesOne], ctx('(3 + 4) * 1'))).toHaveLength(1);
  });

  it('exige el operador correcto', () => {
    expect(engine.validate([sevenTimesOne], ctx('7 / 1'))).toHaveLength(1);
  });
});

describe('RuleEngine', () => {
  it('valida varias reglas simultáneamente y devuelve todas las violaciones', () => {
    // Contiene el 2 y no usa 7 * 1 → incumple ambas.
    const violations = engine.validate([noTwo, sevenTimesOne], ctx('21'));
    expect(violations.map((v) => v.ruleId).sort()).toEqual(['no-2', 'req-7x1']);
  });

  it('una expresión que cumple todas las reglas no tiene violaciones', () => {
    expect(engine.validate([noTwo, sevenTimesOne, noFive], ctx('7 * 1 * 3'))).toEqual([]);
  });

  it('sin reglas, cualquier expresión pasa', () => {
    expect(engine.validate([], ctx('21'))).toEqual([]);
  });

  it('lanza error ante un tipo de regla desconocido', () => {
    const unknown: RuleDefinition = { id: 'x', type: 'NOPE', description: '', config: {} };
    expect(() => engine.validate([unknown], ctx('1'))).toThrow(UnknownRuleTypeError);
    expect(() => engine.assertValidDefinition(unknown)).toThrow(UnknownRuleTypeError);
  });

  it.each([{ digit: 10 }, { digit: -1 }, { digit: 1.5 }, { digit: '2' }, {}])(
    'rechaza configuración inválida de FORBIDDEN_DIGIT %j',
    (config) => {
      expect(() => engine.assertValidDefinition({ ...noTwo, config })).toThrow(InvalidRuleConfigError);
    },
  );

  it('rechaza configuración inválida de REQUIRED_OPERATION', () => {
    for (const config of [
      { operator: '%', left: 1, right: 2 },
      { operator: '*', left: -1, right: 2 },
      { operator: '*', left: 1 },
    ]) {
      expect(() => engine.assertValidDefinition({ ...sevenTimesOne, config })).toThrow(
        InvalidRuleConfigError,
      );
    }
  });

  it('es extensible: se puede registrar un tipo de regla nuevo sin modificar el motor', () => {
    const forbiddenOperator: RuleHandler<{ operator: string }> = {
      type: 'FORBIDDEN_OPERATION',
      parseConfig: (raw) => ({ operator: String(raw.operator) }),
      check: ({ operator }, { expression }) => {
        const uses = JSON.stringify(expression, (_k, v) =>
          typeof v === 'bigint' ? v.toString() : v,
        ).includes(`"operator":"${operator}"`);
        return uses ? `No puedes usar "${operator}".` : null;
      },
    };
    const custom = new RuleEngine([forbiddenDigitRule]).register(forbiddenOperator);
    const rule: RuleDefinition = {
      id: 'no-plus',
      type: 'FORBIDDEN_OPERATION',
      description: '',
      config: { operator: '+' },
    };

    expect(custom.validate([rule], ctx('2 + 2'))).toHaveLength(1);
    expect(custom.validate([rule], ctx('2 * 2'))).toEqual([]);
  });

  it('no permite registrar dos handlers para el mismo tipo', () => {
    expect(() => new RuleEngine([forbiddenDigitRule]).register(forbiddenDigitRule)).toThrow('Ya existe');
  });
});

describe('RuleAccumulator', () => {
  it('acumula reglas en orden de desbloqueo y es inmutable', () => {
    const empty = RuleAccumulator.empty();
    const one = empty.unlock(noTwo);
    const two = one.unlock(sevenTimesOne);

    expect(empty.count).toBe(0);
    expect(one.rules.map((r) => r.id)).toEqual(['no-2']);
    expect(two.rules.map((r) => r.id)).toEqual(['no-2', 'req-7x1']);
  });

  it('desbloquear una regla ya activa es idempotente', () => {
    const acc = RuleAccumulator.from([noTwo, sevenTimesOne]);
    expect(acc.unlock(noTwo)).toBe(acc);
    expect(RuleAccumulator.from([noTwo, noTwo]).count).toBe(1);
  });
});
