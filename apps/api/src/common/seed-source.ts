import { randomInt } from 'node:crypto';

/** Mayor semilla de secuencia (cabe en un INTEGER con signo de PostgreSQL). */
export const MAX_SEED = 2_147_483_647;

/**
 * Fuente de semillas para planificar secuencias. En producción es aleatoria (el jugador no puede predecir qué
 * reglas tocarán); en pruebas y en el seed de demostración se sustituye por una determinista. La semilla se guarda
 * con la secuencia, así que cualquier secuencia se puede reproducir.
 */
export abstract class SeedSource {
  /** Entero en [0, MAX_SEED]. */
  abstract next(): number;
}

export class RandomSeedSource extends SeedSource {
  next(): number {
    return randomInt(0, MAX_SEED + 1);
  }
}

/** Semillas consecutivas desde `start` (pruebas y fixtures de demostración). */
export class SequentialSeedSource extends SeedSource {
  constructor(private current = 1) {
    super();
  }

  next(): number {
    const seed = this.current;
    this.current = this.current >= MAX_SEED ? 0 : this.current + 1;
    return seed;
  }
}
