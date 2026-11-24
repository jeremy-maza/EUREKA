import {
  RuleDefinition,
  RuleEngine,
  createDefaultRuleEngine,
  forbiddenDigitRule,
  requiredOperationRule,
} from '../rules';
import { checkRuleCompatibility, emptyRuleConstraints } from './rule-compatibility';

const forbid = (digit: number): RuleDefinition => ({
  id: `no-${digit}`,
  type: 'FORBIDDEN_DIGIT',
  description: `No ${digit}`,
  config: { digit },
});
const mustUse = (operator: string, left: number, right: number): RuleDefinition => ({
  id: `req-${left}${operator}${right}`,
  type: 'REQUIRED_OPERATION',
  description: `Usa ${left} ${operator} ${right}`,
  config: { operator, left, right },
});

const conflictCodes = (rules: RuleDefinition[], options = {}) => {
  const result = checkRuleCompatibility(rules, options);
  expect(result.status).toBe('INCOMPATIBLE');
  return result.status === 'INCOMPATIBLE' ? result.conflicts.map((c) => c.code) : [];
};

describe('checkRuleCompatibility — sin conflicto demostrado', () => {
  it('sin reglas', () => {
    expect(checkRuleCompatibility([])).toEqual({
      status: 'NO_CONFLICT_FOUND',
      constraints: emptyRuleConstraints(),
    });
  });

  it('combinaciones compatibles, incluidas las del mundo de Aritmética', () => {
    const rules = [forbid(2), mustUse('*', 7, 1), forbid(5)];
    const result = checkRuleCompatibility(rules);
    expect(result.status).toBe('NO_CONFLICT_FOUND');
    if (result.status === 'NO_CONFLICT_FOUND') {
      expect(result.constraints.rules).toBe(rules);
      expect(result.constraints.forbiddenDigits).toEqual([2, 5]);
      expect(result.constraints.requiredOperations).toEqual([{ operator: '*', left: 7, right: 1 }]);
    }
  });

  it('dígitos prohibidos repetidos y operaciones equivalentes se deduplican', () => {
    const result = checkRuleCompatibility([
      forbid(5),
      forbid(2),
      forbid(5),
      mustUse('*', 7, 1),
      mustUse('*', 1, 7),
    ]);
    expect(result.status).toBe('NO_CONFLICT_FOUND');
    if (result.status === 'NO_CONFLICT_FOUND') {
      expect(result.constraints.forbiddenDigits).toEqual([2, 5]);
      expect(result.constraints.requiredOperations).toHaveLength(1);
    }
  });

  it('- y / no son conmutativos: 7 - 1 y 1 - 7 son operaciones distintas', () => {
    const result = checkRuleCompatibility([mustUse('-', 7, 1), mustUse('-', 1, 7)]);
    expect(result.status === 'NO_CONFLICT_FOUND' && result.constraints.requiredOperations).toHaveLength(2);
  });

  it('varias operaciones exigidas distintas son compatibles entre sí', () => {
    expect(checkRuleCompatibility([mustUse('*', 7, 1), mustUse('+', 3, 4), mustUse('/', 8, 2)]).status).toBe(
      'NO_CONFLICT_FOUND',
    );
  });

  it('9 dígitos prohibidos todavía no es una incompatibilidad demostrada', () => {
    expect(checkRuleCompatibility([1, 2, 3, 4, 5, 6, 7, 8, 9].map(forbid)).status).toBe('NO_CONFLICT_FOUND');
  });
});

describe('checkRuleCompatibility — incompatibilidades confirmadas', () => {
  it('FORBIDDEN_DIGIT(7) + REQUIRED_OPERATION(7 * 1)', () => {
    const result = checkRuleCompatibility([forbid(7), mustUse('*', 7, 1)]);
    expect(result).toMatchObject({
      status: 'INCOMPATIBLE',
      conflicts: [{ code: 'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL', ruleIds: ['no-7', 'req-7*1'] }],
    });
  });

  it('FORBIDDEN_DIGIT(1) + REQUIRED_OPERATION(7 * 1): el operando derecho también cuenta', () => {
    expect(conflictCodes([forbid(1), mustUse('*', 7, 1)])).toEqual([
      'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL',
    ]);
  });

  it('el orden de las reglas no importa', () => {
    expect(conflictCodes([mustUse('*', 7, 1), forbid(7)])).toEqual([
      'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL',
    ]);
  });

  it('detecta el dígito dentro de literales de varias cifras (y el 0)', () => {
    expect(conflictCodes([forbid(2), mustUse('+', 12, 3)])).toEqual([
      'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL',
    ]);
    expect(conflictCodes([forbid(0), mustUse('*', 10, 3)])).toEqual([
      'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL',
    ]);
    expect(conflictCodes([forbid(0), mustUse('+', 0, 3)])).toEqual([
      'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL',
    ]);
  });

  it('REQUIRED_OPERATION(7 / 0): división entre cero intrínseca', () => {
    expect(conflictCodes([mustUse('/', 7, 0)])).toEqual(['REQUIRED_OPERATION_DIVISION_BY_ZERO']);
    expect(conflictCodes([mustUse('/', 0, 0)])).toEqual(['REQUIRED_OPERATION_DIVISION_BY_ZERO']);
  });

  it('0 / 7 (cero en el dividendo) y 7 * 0 NO son imposibles', () => {
    expect(checkRuleCompatibility([mustUse('/', 0, 7)]).status).toBe('NO_CONFLICT_FOUND');
    expect(checkRuleCompatibility([mustUse('*', 7, 0)]).status).toBe('NO_CONFLICT_FOUND');
  });

  it('los 10 dígitos prohibidos: no se puede escribir ningún número', () => {
    const result = checkRuleCompatibility([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(forbid));
    expect(result).toMatchObject({ status: 'INCOMPATIBLE', conflicts: [{ code: 'ALL_DIGITS_FORBIDDEN' }] });
  });

  it('las operaciones exigidas no caben en la longitud máxima', () => {
    const huge = 10 ** 12;
    expect(conflictCodes([mustUse('*', huge, huge)], { maxExpressionLength: 20 })).toEqual([
      'REQUIRED_OPERATIONS_EXCEED_MAX_LENGTH',
    ]);
    // Operaciones distintas: se suman sus longitudes + operadores de enlace (3 + 3 + 1 = 7).
    expect(conflictCodes([mustUse('*', 7, 1), mustUse('+', 3, 4)], { maxExpressionLength: 6 })).toEqual([
      'REQUIRED_OPERATIONS_EXCEED_MAX_LENGTH',
    ]);
    expect(
      checkRuleCompatibility([mustUse('*', 7, 1), mustUse('+', 3, 4)], { maxExpressionLength: 7 }).status,
    ).toBe('NO_CONFLICT_FOUND');
    // Operaciones equivalentes comparten nodo: solo cuentan una vez.
    expect(
      checkRuleCompatibility([mustUse('*', 7, 1), mustUse('*', 1, 7)], { maxExpressionLength: 3 }).status,
    ).toBe('NO_CONFLICT_FOUND');
  });

  it('informa de todos los conflictos a la vez', () => {
    expect(conflictCodes([forbid(7), mustUse('*', 7, 1), mustUse('/', 4, 0)]).sort()).toEqual([
      'FORBIDDEN_DIGIT_BLOCKS_REQUIRED_LITERAL',
      'REQUIRED_OPERATION_DIVISION_BY_ZERO',
    ]);
  });
});

describe('checkRuleCompatibility — reglas no soportadas o inválidas', () => {
  const custom: RuleDefinition = {
    id: 'no-plus',
    type: 'FORBIDDEN_OPERATION',
    description: '',
    config: { operator: '+' },
  };
  const forbiddenOperationHandler = {
    type: 'FORBIDDEN_OPERATION',
    parseConfig: (raw: Record<string, unknown>) => ({ operator: String(raw.operator) }),
    check: () => null,
  };

  it('tipo desconocido para el RuleEngine → UNSUPPORTED (no INCOMPATIBLE)', () => {
    const result = checkRuleCompatibility([forbid(2), custom]);
    expect(result).toMatchObject({
      status: 'UNSUPPORTED',
      issues: [{ code: 'UNKNOWN_RULE_TYPE', ruleId: 'no-plus', ruleType: 'FORBIDDEN_OPERATION' }],
    });
  });

  it('tipo que el RuleEngine conoce pero el generador no → UNSUPPORTED', () => {
    const engine = new RuleEngine([forbiddenDigitRule, requiredOperationRule]).register(
      forbiddenOperationHandler,
    );
    const result = checkRuleCompatibility([custom], { ruleEngine: engine });
    expect(result).toMatchObject({
      status: 'UNSUPPORTED',
      issues: [{ code: 'RULE_TYPE_NOT_SUPPORTED_BY_GENERATOR', ruleId: 'no-plus' }],
    });
  });

  it('una regla no soportada tiene prioridad sobre conflictos entre las demás', () => {
    expect(checkRuleCompatibility([forbid(7), mustUse('*', 7, 1), custom]).status).toBe('UNSUPPORTED');
  });

  it.each([{ digit: 10 }, { digit: -1 }, { digit: 1.5 }, { digit: '2' }, {}])(
    'configuración inválida de FORBIDDEN_DIGIT %j → INVALID_CONFIG',
    (config) => {
      const result = checkRuleCompatibility([{ ...forbid(2), config }]);
      expect(result).toMatchObject({
        status: 'INVALID_CONFIG',
        issues: [{ code: 'INVALID_RULE_CONFIG', ruleId: 'no-2' }],
      });
    },
  );

  it('configuración inválida de REQUIRED_OPERATION y de id vacío', () => {
    expect(
      checkRuleCompatibility([{ ...mustUse('*', 7, 1), config: { operator: '%', left: 1, right: 2 } }])
        .status,
    ).toBe('INVALID_CONFIG');
    expect(
      checkRuleCompatibility([{ ...mustUse('*', 7, 1), config: { operator: '*', left: -1, right: 2 } }])
        .status,
    ).toBe('INVALID_CONFIG');
    expect(checkRuleCompatibility([{ ...forbid(2), id: '  ' }]).status).toBe('INVALID_CONFIG');
  });

  it('la configuración inválida tiene prioridad sobre las reglas no soportadas', () => {
    expect(checkRuleCompatibility([custom, { ...forbid(2), config: {} }]).status).toBe('INVALID_CONFIG');
  });

  it('usa el RuleEngine inyectado y, por defecto, el de producción', () => {
    const engine = createDefaultRuleEngine();
    const spy = jest.spyOn(engine, 'assertValidDefinition');
    checkRuleCompatibility([forbid(2)], { ruleEngine: engine });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
