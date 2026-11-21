import { createChallengeEngine, createDefaultRuleEngine, RuleDefinition } from '../challenges';
import { arithmeticWorld } from './catalog/arithmetic.world';
import { WorldDefinitionError, validateWorldDefinition } from './world-validator';
import { WorldCatalog } from './worlds.service';
import { WorldDefinition } from './world.types';

const ruleEngine = createDefaultRuleEngine();
const challengeEngine = createChallengeEngine(ruleEngine);
const engines = { ruleEngine, challengeEngine };

describe('Mundo 1: Aritmética (catálogo determinista)', () => {
  it('es una definición válida', () => {
    expect(() => validateWorldDefinition(arithmeticWorld, engines)).not.toThrow();
  });

  it('cada reto es resoluble con TODAS las reglas del mundo activas (incluye reiniciar con reglas acumuladas)', () => {
    for (const challenge of arithmeticWorld.challenges) {
      expect(challengeEngine.verifySolvable(challenge, arithmeticWorld.rules)).toEqual({
        solvable: true,
        reason: null,
      });
    }
  });

  it('...y por tanto con cualquier subconjunto acumulado de reglas', () => {
    const rules = arithmeticWorld.rules;
    for (const challenge of arithmeticWorld.challenges) {
      for (let k = 0; k <= rules.length; k++) {
        expect(challengeEngine.verifySolvable(challenge, rules.slice(0, k)).solvable).toBe(true);
      }
    }
  });

  it('incluye los ejemplos del enunciado', () => {
    const [c1, c2, c3] = arithmeticWorld.challenges;
    expect([c1.expression, c1.expectedResult]).toEqual(['3 * 7', '21']);
    expect([c2.expression, c2.expectedResult]).toEqual(['3 * 7 * 2', '42']);
    expect([c3.expression, c3.expectedResult]).toEqual(['3 * 7 * 2 / 6', '7']);
  });

  it('una regla nunca se define dentro del reto: el reto solo la referencia', () => {
    for (const challenge of arithmeticWorld.challenges) {
      expect(challenge).not.toHaveProperty('rule');
      expect(challenge).not.toHaveProperty('rules');
    }
  });
});

describe('validateWorldDefinition detecta catálogos defectuosos', () => {
  const noTwo: RuleDefinition = { id: 'r1', type: 'FORBIDDEN_DIGIT', description: '', config: { digit: 2 } };
  const base: WorldDefinition = {
    slug: 'test',
    name: 'Test',
    description: '',
    position: 9,
    rules: [noTwo],
    challenges: [
      {
        id: 'c1',
        position: 1,
        expression: '1 + 1',
        expectedResult: '2',
        introducesRuleId: 'r1',
        referenceSolution: '4 - 2',
      },
    ],
  };
  const problemsOf = (world: WorldDefinition): string[] => {
    try {
      validateWorldDefinition(world, engines);
    } catch (error) {
      expect(error).toBeInstanceOf(WorldDefinitionError);
      return [...(error as WorldDefinitionError).problems];
    }
    return [];
  };

  it('reto irresoluble: la solución de referencia viola una regla', () => {
    // "4 - 2" contiene el 2 prohibido
    expect(problemsOf(base).join(' ')).toContain('no resoluble');
  });

  it('regla inexistente, regla huérfana y posiciones incorrectas', () => {
    const world: WorldDefinition = {
      ...base,
      rules: [noTwo, { ...noTwo, id: 'orphan' }],
      challenges: [
        { ...base.challenges[0], position: 3, introducesRuleId: 'ghost', referenceSolution: '1 + 1' },
      ],
    };
    const text = problemsOf(world).join('\n');
    expect(text).toContain('position 3');
    expect(text).toContain('regla inexistente "ghost"');
    expect(text).toContain('"r1" no la introduce ningún reto');
  });

  it('reglas con tipo desconocido', () => {
    const world: WorldDefinition = { ...base, rules: [{ ...noTwo, type: 'WAT' }] };
    expect(problemsOf(world).join(' ')).toContain('WAT');
  });
});

describe('WorldCatalog', () => {
  it('lista por posición y obtiene por slug', () => {
    const catalog = new WorldCatalog([{ ...arithmeticWorld, slug: 'b', position: 2 }, arithmeticWorld]);
    expect(catalog.list().map((w) => w.slug)).toEqual(['arithmetic', 'b']);
    expect(catalog.get('arithmetic')).toBe(arithmeticWorld);
    expect(() => catalog.get('zzz')).toThrow('Mundo desconocido');
  });
});
