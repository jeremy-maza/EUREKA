import { checkRuleCompatibility, createChallengeEngine, createDefaultRuleEngine } from '../challenges';
import { ALL_WORLDS, algebraWorld, arithmeticWorld, chaosWorld, fractionsWorld, signsWorld } from './catalog';
import { validateWorldCatalog, validateWorldDefinition } from './world-validator';
import { DIFFICULTY_LEVELS } from './world.types';
import { WorldCatalog } from './worlds.service';

const ruleEngine = createDefaultRuleEngine();
const challengeEngine = createChallengeEngine(ruleEngine);
const deps = { ruleEngine, challengeEngine };

describe('catálogo de los cinco mundos', () => {
  it('ALL_WORLDS está en orden de posición 1..5', () => {
    expect(ALL_WORLDS.map((w) => [w.position, w.slug])).toEqual([
      [1, 'arithmetic'],
      [2, 'signs'],
      [3, 'fractions'],
      [4, 'algebra'],
      [5, 'chaos'],
    ]);
  });

  it.each(ALL_WORLDS.map((w) => [w.slug, w] as const))('%s es una definición válida', (_slug, world) => {
    expect(() => validateWorldDefinition(world, deps)).not.toThrow();
  });

  it('el catálogo completo es válido y se valida en menos de 1 s', () => {
    const start = process.hrtime.bigint();
    validateWorldCatalog(ALL_WORLDS, deps);
    expect(Number(process.hrtime.bigint() - start) / 1e6).toBeLessThan(1000);
  });

  it('Mundo 1 conserva EXACTAMENTE las tres reglas originales (filas de BD e historial las referencian)', () => {
    expect(arithmeticWorld).toMatchObject({ slug: 'arithmetic', name: 'Aritmética', position: 1 });
    expect(arithmeticWorld.rules.slice(0, 3)).toEqual([
      {
        id: 'arithmetic.forbidden-digit-2',
        type: 'FORBIDDEN_DIGIT',
        description: 'No puedes usar el dígito 2.',
        config: { digit: 2 },
      },
      {
        id: 'arithmetic.required-7-times-1',
        type: 'REQUIRED_OPERATION',
        description: 'Debes usar la multiplicación 7 * 1.',
        config: { operator: '*', left: 7, right: 1 },
      },
      {
        id: 'arithmetic.forbidden-digit-5',
        type: 'FORBIDDEN_DIGIT',
        description: 'No puedes usar el dígito 5.',
        config: { digit: 5 },
      },
    ]);
    expect(arithmeticWorld).not.toHaveProperty('challenges');
  });

  it('la sintaxis crece de mundo en mundo', () => {
    expect(arithmeticWorld.syntax).toEqual({ decimals: false, powers: false });
    expect(signsWorld.syntax).toEqual({ decimals: false, powers: false });
    expect(fractionsWorld.syntax).toEqual({ decimals: true, powers: false });
    expect(algebraWorld.syntax).toEqual({ decimals: false, powers: true });
    expect(chaosWorld.syntax).toEqual({ decimals: true, powers: true });
  });

  it('ruleCount según el plan maestro (2/3/4 en los mundos 1–4, 3/4/5 en Caos) y repertorio ≥ HARDER', () => {
    for (const world of ALL_WORLDS) {
      const expected =
        world.slug === 'chaos'
          ? { EASIER: 3, BASELINE: 4, HARDER: 5 }
          : { EASIER: 2, BASELINE: 3, HARDER: 4 };
      expect(world.sequence.ruleCount).toEqual(expected);
      expect(world.rules.length).toBeGreaterThanOrEqual(world.sequence.ruleCount.HARDER);
    }
  });

  it('la dificultad no disminuye: tiempo extra, reglas por secuencia y tope de resultados', () => {
    for (let i = 1; i < ALL_WORLDS.length; i++) {
      const [previous, current] = [ALL_WORLDS[i - 1], ALL_WORLDS[i]];
      expect(current.sequence.extraTimeSeconds).toBeGreaterThanOrEqual(previous.sequence.extraTimeSeconds);
      expect(current.sequence.ruleCount.HARDER).toBeGreaterThanOrEqual(previous.sequence.ruleCount.HARDER);
    }
    for (const world of ALL_WORLDS) {
      // Dentro de un mundo, cada nivel es al menos tan exigente como el anterior.
      const levels = DIFFICULTY_LEVELS.map((level) => world.generation.profiles[level].last);
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i].operandRange.max).toBeGreaterThanOrEqual(levels[i - 1].operandRange.max);
        expect(levels[i].maxResult ?? Infinity).toBeGreaterThanOrEqual(levels[i - 1].maxResult ?? 0);
      }
    }
  });

  it('ids "<slug>.<kebab>", descripciones en español no vacías y 3–4 conceptos', () => {
    for (const world of ALL_WORLDS) {
      expect(world.concepts.length).toBeGreaterThanOrEqual(3);
      expect(world.concepts.length).toBeLessThanOrEqual(4);
      for (const rule of world.rules) {
        expect(rule.id).toMatch(new RegExp(`^${world.slug}\\.[a-z0-9]+(-[a-z0-9]+)*$`));
        expect(rule.description.length).toBeGreaterThan(10);
      }
    }
  });

  it('ningún mundo usa FORBIDDEN_OPERATOR: sola nunca rechaza el resultado escrito como literal', () => {
    for (const world of ALL_WORLDS)
      expect(world.rules.map((r) => r.type)).not.toContain('FORBIDDEN_OPERATOR');
  });

  it('cada repertorio es compatible entre sí con la sintaxis de su mundo', () => {
    for (const world of ALL_WORLDS) {
      expect(checkRuleCompatibility(world.rules, { syntax: world.syntax }).status).toBe('NO_CONFLICT_FOUND');
    }
  });

  it('los mundos con ecuaciones dan más tiempo', () => {
    expect(algebraWorld.sequence.extraTimeSeconds).toBeGreaterThan(arithmeticWorld.sequence.extraTimeSeconds);
    expect(chaosWorld.sequence.extraTimeSeconds).toBeGreaterThanOrEqual(
      algebraWorld.sequence.extraTimeSeconds,
    );
  });
});

describe('WorldCatalog', () => {
  it('lista por posición y obtiene por slug', () => {
    const catalog = new WorldCatalog([...ALL_WORLDS].reverse());
    expect(catalog.list().map((w) => w.slug)).toEqual(ALL_WORLDS.map((w) => w.slug));
    expect(catalog.get('arithmetic')).toBe(arithmeticWorld);
    expect(() => catalog.get('zzz')).toThrow('Mundo desconocido');
  });
});
