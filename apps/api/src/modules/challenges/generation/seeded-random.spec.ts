import { SeededRandom, deriveSeed } from './seeded-random';

/** Implementación de referencia de mulberry32 (versión pública habitual), independiente de la del módulo. */
function referenceMulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const take = (rng: SeededRandom, n: number) => Array.from({ length: n }, () => rng.next());

describe('SeededRandom', () => {
  it('la misma semilla produce exactamente la misma secuencia', () => {
    expect(take(new SeededRandom(12345), 50)).toEqual(take(new SeededRandom(12345), 50));
  });

  it('semillas distintas producen secuencias distintas', () => {
    expect(take(new SeededRandom(1), 10)).not.toEqual(take(new SeededRandom(2), 10));
  });

  it('coincide con la implementación de referencia de mulberry32', () => {
    for (const seed of [0, 1, 42, 123456789, 4294967295]) {
      const reference = referenceMulberry32(seed);
      const rng = new SeededRandom(seed);
      for (let i = 0; i < 20; i++) expect(rng.next()).toBe(reference());
    }
  });

  it('valores fijados (guardan contra cambios accidentales del algoritmo)', () => {
    expect(take(new SeededRandom(42), 3)).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
    ]);
  });

  it('next() siempre está en [0, 1)', () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 5000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('nextInt() respeta el rango cerrado y alcanza ambos extremos', () => {
    const rng = new SeededRandom(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const value = rng.nextInt(3, 7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
    expect(new SeededRandom(1).nextInt(5, 5)).toBe(5);
  });

  it('semillas negativas o mayores que 32 bits se reducen de forma determinista', () => {
    expect(take(new SeededRandom(-1), 3)).toEqual(take(new SeededRandom(4294967295), 3));
    expect(take(new SeededRandom(2 ** 32 + 5), 3)).toEqual(take(new SeededRandom(5), 3));
  });

  it.each([1.5, NaN, Infinity, 2 ** 53])('rechaza semillas no enteras o no seguras (%p)', (seed) => {
    expect(() => new SeededRandom(seed)).toThrow(RangeError);
  });

  it('nextInt() rechaza rangos inválidos', () => {
    const rng = new SeededRandom(1);
    expect(() => rng.nextInt(5, 4)).toThrow(RangeError);
    expect(() => rng.nextInt(0.5, 3)).toThrow(RangeError);
    expect(() => rng.nextInt(0, 2 ** 33)).toThrow(RangeError);
  });

  it('pick() elige un elemento y falla con listas vacías', () => {
    const items = ['a', 'b', 'c'];
    const rng = new SeededRandom(3);
    for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('shuffle() devuelve una permutación determinista y no modifica la entrada', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = new SeededRandom(11).shuffle(items);
    expect(a).toEqual(new SeededRandom(11).shuffle(items));
    expect([...a].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('no usa Math.random ni el reloj', () => {
    const random = jest.spyOn(Math, 'random');
    const now = jest.spyOn(Date, 'now');
    const rng = new SeededRandom(5);
    rng.next();
    rng.nextInt(1, 10);
    rng.shuffle([1, 2, 3]);
    deriveSeed(5, 1, 2);
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    random.mockRestore();
    now.mockRestore();
  });
});

describe('deriveSeed', () => {
  it('es determinista y devuelve un entero de 32 bits sin signo', () => {
    expect(deriveSeed(42, 3, 1)).toBe(deriveSeed(42, 3, 1));
    for (let i = 0; i < 100; i++) {
      const derived = deriveSeed(42, i);
      expect(Number.isInteger(derived)).toBe(true);
      expect(derived).toBeGreaterThanOrEqual(0);
      expect(derived).toBeLessThan(2 ** 32);
    }
  });

  it('sales distintas dan sub-semillas distintas, y el orden de las sales importa', () => {
    const derived = new Set(Array.from({ length: 200 }, (_, i) => deriveSeed(42, i)));
    expect(derived.size).toBe(200);
    expect(deriveSeed(42, 1, 2)).not.toBe(deriveSeed(42, 2, 1));
    expect(deriveSeed(42, 0)).not.toBe(deriveSeed(43, 0));
  });

  it('rechaza valores no enteros', () => {
    expect(() => deriveSeed(1.5)).toThrow(RangeError);
    expect(() => deriveSeed(1, 0.5)).toThrow(RangeError);
  });
});
