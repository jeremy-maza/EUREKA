import { ChallengeDefinition } from '../challenges';
import { DifficultyLevel } from '../worlds/world.types';

/** Reto planificado: un `ChallengeDefinition` generado más metadatos de auditoría (nunca se exponen). */
export interface PlannedChallenge extends ChallengeDefinition {
  generation: {
    fingerprint: string;
    generatorVersion: string;
    /** Plantilla/familia de enunciado usada (p. ej. "PRODUCT_CHAIN", "LINEAR_EQUATION"). */
    templateId: string;
    /** Semilla con la que se generó ESTE reto (derivada de la de la secuencia). */
    seed: number;
  };
}

/**
 * Secuencia completa decidida al empezarla. Contrato entre el planificador (puro) y la persistencia:
 *  - `ruleIds`: subconjunto aleatorio de las reglas del mundo, en orden de introducción (longitud k).
 *  - `challenges`: k + 1 retos; `challenges[i].position === i + 1`; el primero no introduce regla y
 *    `challenges[i].introducesRuleId === ruleIds[i - 1]` para i ≥ 1.
 *  - Cada reto es resoluble con las reglas activas en su posición (`ruleIds.slice(0, position - 1)`) y su
 *    `referenceSolution` pasa `ChallengeEngine.verifySolvable` con esas reglas y la sintaxis del mundo.
 *  - Determinista: (mundo, seed, difficulty) ⇒ el mismo plan.
 */
export interface SequencePlan {
  worldSlug: string;
  /** Entero en [0, 2^31 - 1] (cabe en un INTEGER de PostgreSQL). */
  seed: number;
  difficulty: DifficultyLevel;
  ruleIds: readonly string[];
  challenges: readonly PlannedChallenge[];
  generatorVersion: string;
}

export interface PlanSequenceInput {
  seed: number;
  difficulty: DifficultyLevel;
}

/** No se pudo planificar ninguna secuencia válida dentro del presupuesto (defecto del catálogo, no del jugador). */
export class SequencePlanningError extends Error {
  constructor(
    readonly worldSlug: string,
    message: string,
  ) {
    super(message);
    this.name = 'SequencePlanningError';
  }
}

/** Mayor semilla admitida (INTEGER de PostgreSQL con signo). */
export const MAX_SEQUENCE_SEED = 2_147_483_647;
