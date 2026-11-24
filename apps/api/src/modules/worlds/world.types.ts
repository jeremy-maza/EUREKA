import { MathSyntax, RuleDefinition, WorldGenerationConfig } from '../challenges';

/**
 * Nivel de dificultad de una secuencia. Lo elige la `DifficultyPolicy` (modules/game/difficulty.ts) a partir
 * de la racha y el rendimiento del jugador al empezar cada secuencia, y se guarda con ella.
 * Vive aquí (capa de catálogo) para que el planificador de secuencias no dependa del módulo de juego.
 */
export type DifficultyLevel = 'EASIER' | 'BASELINE' | 'HARDER';

export const DIFFICULTY_LEVELS: readonly DifficultyLevel[] = ['EASIER', 'BASELINE', 'HARDER'];

/** Cómo se construye cada secuencia del mundo. */
export interface WorldSequenceConfig {
  /**
   * Reglas que introduce una secuencia según la dificultad (subconjunto aleatorio del `rules` del mundo, en
   * orden aleatorio). La secuencia tiene `ruleCount + 1` retos: el primero no introduce regla.
   * Debe cumplirse 1 ≤ EASIER ≤ BASELINE ≤ HARDER ≤ rules.length.
   */
  ruleCount: Readonly<Record<DifficultyLevel, number>>;
  /** Segundos que se suman al tiempo límite de cada reto del mundo (≥ 0), p. ej. por resolver ecuaciones. */
  extraTimeSeconds: number;
}

/**
 * Catálogo de un mundo. La fuente de verdad es el código (`catalog/*.world.ts`); la BD guarda mundos y reglas
 * (`npm run db:seed`) para que los intentos y estadísticas puedan referenciarlos.
 *
 * Los retos ya NO son una lista fija: al empezar cada secuencia el planificador (`modules/sequences`) elige un
 * subconjunto aleatorio de `rules`, lo baraja y genera un reto por posición con el generador determinista.
 */
export interface WorldDefinition {
  slug: string;
  name: string;
  description: string;
  /** Orden de presentación y de desbloqueo (1 = Aritmética … 5 = Caos matemático). */
  position: number;
  /** Objetivos de aprendizaje, para mostrarlos al jugador (p. ej. "Números negativos"). */
  concepts: readonly string[];
  /** Repertorio de reglas del mundo (la secuencia usa un subconjunto). */
  rules: readonly RuleDefinition[];
  /** Sintaxis admitida en las respuestas (y en los enunciados) de este mundo. */
  syntax: MathSyntax;
  sequence: WorldSequenceConfig;
  /** Perfiles del generador (familias de enunciados, rangos, complejidad) por nivel de dificultad. */
  generation: WorldGenerationConfig;
}
