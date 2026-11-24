/**
 * Generador pseudoaleatorio determinista basado en mulberry32 (Tommy Ettinger, dominio público):
 * estado de 32 bits, periodo 2^32, ligero y sin dependencias. NO es criptográfico: sirve únicamente
 * para que la generación de retos sea reproducible a partir de una semilla explícita.
 *
 * Nunca usa `Math.random()` ni el reloj.
 */
export class SeededRandom {
  private state: number;

  /** @param seed entero seguro; se reduce a 32 bits sin signo (`seed >>> 0`). @throws RangeError */
  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) {
      throw new RangeError(`La semilla debe ser un entero seguro (recibido: ${seed}).`);
    }
    this.state = seed >>> 0;
  }

  /** Siguiente valor en el intervalo semiabierto [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entero uniforme en el intervalo cerrado [min, max]. @throws RangeError */
  nextInt(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max) {
      throw new RangeError(`Rango inválido [${min}, ${max}].`);
    }
    const span = max - min + 1;
    if (span > 4294967296) throw new RangeError('El rango supera 2^32 valores.');
    return min + Math.floor(this.next() * span);
  }

  /** `true` con probabilidad `probability` (en [0, 1]). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Elemento uniforme de una lista no vacía. @throws RangeError */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('No se puede elegir de una lista vacía.');
    return items[this.nextInt(0, items.length - 1)];
  }

  /** Copia barajada (Fisher–Yates); no modifica la lista original. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

/**
 * Deriva una sub-semilla estable a partir de una semilla y sal(es) enteras (índice de candidato,
 * número de reintento…). Mezcla de 32 bits tipo murmur3: sub-semillas cercanas dan flujos distintos.
 */
export function deriveSeed(seed: number, ...salts: number[]): number {
  if (!Number.isSafeInteger(seed))
    throw new RangeError(`La semilla debe ser un entero seguro (recibido: ${seed}).`);
  let hash = seed >>> 0;
  for (const salt of salts) {
    if (!Number.isSafeInteger(salt))
      throw new RangeError(`La sal debe ser un entero seguro (recibido: ${salt}).`);
    hash = Math.imul(hash ^ (salt >>> 0), 0x9e3779b1);
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
  }
  return hash >>> 0;
}
