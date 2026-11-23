import { RuleDefinition, createChallengeEngine, createDefaultRuleEngine } from '../challenges';
import { ALL_WORLDS } from './catalog';
import { arithmeticWorld } from './catalog/arithmetic.world';
import { WorldDefinitionError, validateWorldCatalog, validateWorldDefinition } from './world-validator';
import { WorldDefinition } from './world.types';

const ruleEngine = createDefaultRuleEngine();
const challengeEngine = createChallengeEngine(ruleEngine);
const deps = { ruleEngine, challengeEngine };

const problemsOf = (world: WorldDefinition): string[] => {
  try {
    validateWorldDefinition(world, deps);
  } catch (error) {
    expect(error).toBeInstanceOf(WorldDefinitionError);
    return [...(error as WorldDefinitionError).problems];
  }
  return [];
};

const rule = (id: string, type: string, config: Record<string, unknown> = {}): RuleDefinition => ({
  id,
  type,
  description: 'Una regla de prueba.',
  config,
});

describe('validateWorldDefinition detecta catálogos defectuosos', () => {
  it('reglas duplicadas, ids mal formados y configuraciones inválidas', () => {
    const world: WorldDefinition = {
      ...arithmeticWorld,
      rules: [
        ...arithmeticWorld.rules,
        arithmeticWorld.rules[0],
        rule('otro.mundo', 'FORBIDDEN_DIGIT', { digit: 1 }),
        rule('arithmetic.Mal_Nombre', 'FORBIDDEN_DIGIT', { digit: 3 }),
        rule('arithmetic.bad-config', 'FORBIDDEN_DIGIT', { digit: 12 }),
        rule('arithmetic.unknown', 'WAT'),
      ],
    };
    const text = problemsOf(world).join('\n');
    expect(text).toContain('Regla duplicada: "arithmetic.forbidden-digit-2"');
    expect(text).toContain('"otro.mundo" debe tener la forma "arithmetic.');
    expect(text).toContain('"arithmetic.Mal_Nombre"');
    expect(text).toContain('Configuración inválida');
    expect(text).toContain('WAT');
  });

  it('ruleCount fuera de 1 ≤ EASIER ≤ BASELINE ≤ HARDER ≤ repertorio', () => {
    for (const ruleCount of [
      { EASIER: 0, BASELINE: 1, HARDER: 2 },
      { EASIER: 3, BASELINE: 2, HARDER: 4 },
      { EASIER: 2, BASELINE: 3, HARDER: 7 },
      { EASIER: 1.5, BASELINE: 2, HARDER: 3 },
    ]) {
      const world = { ...arithmeticWorld, sequence: { ...arithmeticWorld.sequence, ruleCount } };
      expect(problemsOf(world).join(' ')).toContain('ruleCount');
    }
  });

  it('datos básicos: slug, posición, conceptos, sintaxis, tiempo extra', () => {
    const world = {
      ...arithmeticWorld,
      slug: 'Mal Slug',
      position: 0,
      concepts: [],
      syntax: { decimals: 'sí' } as never,
      sequence: { ...arithmeticWorld.sequence, extraTimeSeconds: -5 },
    };
    const text = problemsOf(world).join('\n');
    for (const fragment of ['Slug inválido', '"position"', '"concepts"', '"syntax"', 'extraTimeSeconds']) {
      expect(text).toContain(fragment);
    }
  });

  it('perfiles del generador inválidos o incompatibles con la sintaxis', () => {
    const profiles = arithmeticWorld.generation.profiles;
    const world: WorldDefinition = {
      ...arithmeticWorld,
      generation: {
        profiles: {
          ...profiles,
          EASIER: { ...profiles.EASIER, families: [{ family: 'DECIMAL', weight: 1 }] },
          HARDER: {
            ...profiles.HARDER,
            first: { ...profiles.HARDER.first, operandRange: { min: 9, max: 3 } },
          },
        },
      },
    };
    const text = problemsOf(world).join('\n');
    expect(text).toContain('Perfil EASIER');
    expect(text).toContain('DECIMAL requiere una sintaxis con decimales');
    expect(text).toContain('Perfil HARDER.first');
  });

  it('incompatibilidad demostrada del repertorio (p. ej. decimales exigidos sin decimales)', () => {
    const world = {
      ...arithmeticWorld,
      rules: [...arithmeticWorld.rules, rule('arithmetic.decimal', 'REQUIRED_DECIMAL')],
    };
    expect(problemsOf(world).join(' ')).toContain('DECIMALS_NOT_IN_SYNTAX');
  });

  it('un repertorio compatible pero no planificable falla la prueba de planificación', () => {
    // FORBIDDEN_OPERATOR sola nunca rechaza el resultado literal: ninguna secuencia de 1 regla "muerde".
    const world: WorldDefinition = {
      ...arithmeticWorld,
      rules: [rule('arithmetic.no-minus', 'FORBIDDEN_OPERATOR', { operator: '-' })],
      sequence: { ruleCount: { EASIER: 1, BASELINE: 1, HARDER: 1 }, extraTimeSeconds: 0 },
    };
    expect(problemsOf(world).join(' ')).toContain('No se pudo planificar');
  });

  it('validateWorldCatalog exige slugs únicos y posiciones 1..n sin huecos', () => {
    expect(() => validateWorldCatalog([ALL_WORLDS[0], ALL_WORLDS[0]], deps)).toThrow('repetidos');
    expect(() => validateWorldCatalog([ALL_WORLDS[0], ALL_WORLDS[2]], deps)).toThrow('sin huecos');
    expect(() => validateWorldCatalog(ALL_WORLDS, deps)).not.toThrow();
  });
});
